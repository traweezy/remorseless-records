import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { once } from "node:events"
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  runtimeEnvironment,
  runtimeRoleAuditRequired,
  startRuntime,
} from "../backend/scripts/runtime-start.mjs"

const source = new URL("../backend/scripts/runtime-start.mjs", import.meta.url)
const environment = {
  DATABASE_URL: "postgresql://runtime:fixture@db.invalid/app",
  DATABASE_ROLE_SPLIT_REQUIRED: "true",
}
const fixture = async (t, { audit = "process.exit(0)", wait = false } = {}) => {
  const root = await mkdtemp(join(tmpdir(), "rr-runtime-start-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, "src/cli"), { recursive: true })
  await mkdir(join(root, "node_modules/@medusajs/cli"), { recursive: true })
  await copyFile(source, join(root, "runtime-start.mjs"))
  await writeFile(join(root, "src/cli/audit-database-role.js"), audit)
  await writeFile(
    join(root, "observability-register.cjs"),
    "global.preloaded = true"
  )
  await writeFile(
    join(root, "node_modules/@medusajs/cli/cli.js"),
    `const fs = require('node:fs');
     const initial = fs.readFileSync('/proc/self/environ', 'utf8');
     console.log(JSON.stringify({pid:process.pid,preloaded:global.preloaded,
       initialSecret:initial.includes('release-secret-fixture'),
       envSecret:Object.values(process.env).some(v=>v.includes('release-secret-fixture')),
       profile:process.env.DATABASE_ROLE_PROFILE ?? null,
       database:process.env.DATABASE_URL, args:process.argv.slice(2)}));
     ${wait ? "setInterval(()=>{},1000);" : ""}`
  )
  return join(root, "runtime-start.mjs")
}

test("drops release credentials and libpq overrides without mutating input", () => {
  const original = {
    ...environment,
    DATABASE_MIGRATION_URL: "release-secret-fixture",
    DATABASE_BACKUP_URL: "release-secret-fixture",
    DATABASE_ROLE_PROFILE: "migration",
    PGOPTIONS: "-c role=owner",
    PGPASSWORD: "release-secret-fixture",
    PGSERVICEFILE: "/private/pg_service.conf",
    REDIS_URL: "redis://cache.invalid",
  }
  const clean = runtimeEnvironment(original)
  assert.deepEqual(clean, { ...environment, REDIS_URL: original.REDIS_URL })
  assert.equal(original.PGPASSWORD, "release-secret-fixture")
})

test("accepts only explicit supported role split settings", () => {
  for (const value of ["true", "1", " TRUE "]) {
    assert.equal(runtimeRoleAuditRequired(value), true)
  }
  for (const value of [undefined, "", "0", "false", " FALSE "]) {
    assert.equal(runtimeRoleAuditRequired(value), false)
  }
  for (const value of ["yes", "no", "2"]) {
    assert.throws(() => runtimeRoleAuditRequired(value))
  }
})

test("replaces the dirty process before any application or audit import", () => {
  const stopped = new Error("replacement")
  assert.throws(
    () =>
      startRuntime({
        environment: { ...environment, DATABASE_MIGRATION_URL: "secret" },
        executable: "/node",
        script: "/server/runtime-start.mjs",
        execve(file, args, env) {
          assert.equal(file, "/node")
          assert.deepEqual(args, ["/node", "/server/runtime-start.mjs"])
          assert.deepEqual(env, environment)
          throw stopped
        },
        run() {
          assert.fail("audit must not run before replacement")
        },
        chdir() {
          assert.fail("chdir must not run before replacement")
        },
      }),
    (error) => error === stopped
  )
})

test("rejects unavailable, timed out, killed and failing role audits", () => {
  for (const result of [
    { error: new Error("secret"), status: null },
    { error: { code: "ETIMEDOUT" }, signal: "SIGKILL", status: null },
    { signal: "SIGTERM", status: null },
    { status: 1 },
  ]) {
    assert.throws(
      () =>
        startRuntime({
          environment,
          script: "/server/runtime-start.mjs",
          chdir() {},
          execve() {
            assert.fail("Medusa must not start")
          },
          run(_file, args, options) {
            assert.deepEqual(args, ["/server/src/cli/audit-database-role.js"])
            assert.equal(options.env.DATABASE_ROLE_PROFILE, "runtime")
            assert.equal(options.env.DATABASE_URL, environment.DATABASE_URL)
            assert.equal(options.timeout, 45_000)
            assert.equal(options.killSignal, "SIGKILL")
            return result
          },
        }),
      /runtime_database_role_rejected/u
    )
  }
})

test("fails closed without execve or a runtime URL", () => {
  assert.throws(() => startRuntime({ execve: null }), /execve_unavailable/u)
  assert.throws(
    () => startRuntime({ environment: {}, execve() {} }),
    /database_url_missing/u
  )
})

test("real process replacement removes credentials from JS and Linux environ", async (t) => {
  const script = await fixture(t, {
    audit: `const assert = require('node:assert/strict');
      assert.equal(process.env.DATABASE_ROLE_PROFILE, 'runtime');
      assert.equal(process.env.DATABASE_MIGRATION_URL, undefined);
      assert.equal(process.env.PGPASSWORD, undefined);`,
  })
  const child = spawn(process.execPath, [script], {
    env: {
      ...environment,
      DATABASE_MIGRATION_URL: "release-secret-fixture",
      PGPASSWORD: "release-secret-fixture",
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (data) => {
    stdout += data
  })
  child.stderr.on("data", (data) => {
    stderr += data
  })
  const [code, signal] = await once(child, "close")
  assert.equal(code, 0, stderr)
  assert.equal(signal, null)
  assert.deepEqual(JSON.parse(stdout), {
    pid: child.pid,
    preloaded: true,
    initialSecret: false,
    envSecret: false,
    profile: null,
    database: environment.DATABASE_URL,
    args: ["start", "--verbose"],
  })
})

test("real rejected audit cannot start Medusa or leak raw output", async (t) => {
  const script = await fixture(t, {
    audit: "console.error('release-secret-fixture'); process.exit(1)",
  })
  const result = spawnSync(process.execPath, [script], {
    env: environment,
    encoding: "utf8",
    timeout: 10_000,
  })
  assert.equal(result.status, 1)
  assert.equal(result.stdout, "")
  assert.equal(
    result.stderr,
    "[runtime-start] status=failed reason=startup_boundary\n"
  )
})

test("pre-enforcement startup still scrubs credentials and preserves signals", async (t) => {
  const script = await fixture(t, { audit: "process.exit(1)", wait: true })
  const child = spawn(process.execPath, [script], {
    env: {
      ...environment,
      DATABASE_ROLE_SPLIT_REQUIRED: "false",
      DATABASE_BACKUP_URL: "release-secret-fixture",
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGKILL")
  })
  const closed = once(child, "close")
  const [data] = await once(child.stdout, "data")
  assert.equal(JSON.parse(data.toString()).initialSecret, false)
  child.kill("SIGTERM")
  assert.deepEqual(await closed, [null, "SIGTERM"])
})

test("invalid settings and extra arguments fail before Medusa", async (t) => {
  const script = await fixture(t)
  for (const [env, args] of [
    [{ ...environment, DATABASE_ROLE_SPLIT_REQUIRED: "yes" }, []],
    [environment, ["--skip-audit"]],
  ]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      env,
      encoding: "utf8",
      timeout: 10_000,
    })
    assert.equal(result.status, 1)
    assert.equal(result.stdout, "")
    assert.equal(
      result.stderr,
      "[runtime-start] status=failed reason=startup_boundary\n"
    )
  }
})
