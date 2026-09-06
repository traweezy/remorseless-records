import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  access,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import test from "node:test"
import { createPostgresClientEnvironment } from "./lib/postgres-logical-backup.mjs"

const fixtureContent = "trusted-postgres-fixture"
const targetUrl =
  "postgresql://fixture:fixture-password@localhost/restore_fixture"
const sourceUrl =
  "postgresql://fixture:fixture-password@localhost/source_fixture"
const targetFingerprint = createPostgresClientEnvironment(
  targetUrl,
  "fixture"
).fingerprint

const withFixture = async (run) => {
  const directory = await mkdtemp(join(tmpdir(), "postgres-recovery-cli-"))
  const archive = join(directory, "input.dump")
  const manifestPath = join(directory, "input.manifest.json")
  const output = join(directory, "backups")
  const scratch = join(directory, "scratch")
  try {
    await writeFile(archive, fixtureContent, { mode: 0o600 })
    await writeFile(
      manifestPath,
      JSON.stringify({
        bytes: Buffer.byteLength(fixtureContent),
        createdAt: "2026-09-06T00:00:00.000Z",
        format: "postgres-custom",
        pgDumpVersion: "pg_dump (PostgreSQL) 18.6",
        schemaVersion: 1,
        sha256: createHash("sha256").update(fixtureContent).digest("hex"),
        sourceFingerprint: createPostgresClientEnvironment(sourceUrl, "fixture")
          .fingerprint,
      })
    )
    const executable = `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');
const dir=${JSON.stringify(directory)},args=process.argv.slice(2),tool=path.basename(process.argv[1]);
const config=JSON.parse(fs.readFileSync(path.join(dir,'config.json'),'utf8'));
fs.appendFileSync(path.join(dir,'calls.jsonl'),JSON.stringify({tool,args,keys:Object.keys(process.env),host:process.env.PGHOST,database:process.env.PGDATABASE})+'\\n');
if(config.fail===tool) {console.error('private-fixture-host private-fixture-password');process.exit(7)}
if(tool==='pg_dump'&&args.includes('--version')) console.log('pg_dump (PostgreSQL) 18.6');
else if(config.stall===tool) {fs.writeFileSync(path.join(dir,'pid'),String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000)}
else if(tool==='pg_dump') fs.writeFileSync(args.find(arg=>arg.startsWith('--file=')).slice(7),${JSON.stringify(fixtureContent)});
else if(tool==='pg_restore'&&args.includes('--list')) {
 if(config.badList) {console.error('private-fixture-archive');process.exit(8)}
 if(config.replaceSource) fs.writeFileSync(${JSON.stringify(archive)},'changed-after-verification');
 console.log('verified fixture table of contents');
} else if(tool==='psql') {
 const value=config.inventory??(fs.existsSync(path.join(dir,'restored.dump'))?(config.afterInventory??{tables:1,objects:3}):{tables:0,objects:0});
 console.log(typeof value==='string'?value:JSON.stringify(value));
} else if(tool==='pg_restore') {
 if(config.failRestore) {console.error('private-fixture-password');process.exit(9)}
 if(config.stallRestore) {fs.writeFileSync(path.join(dir,'pid'),String(process.pid));setInterval(()=>{},1000)}
 else fs.copyFileSync(args.at(-1),path.join(dir,'restored.dump'));
}
else process.exit(9);
`
    for (const tool of ["pg_dump", "pg_restore", "psql"])
      await writeFile(join(directory, tool), executable, { mode: 0o700 })
    // Scope temporary snapshots to the fixture so cleanup can be asserted.
    const { mkdir } = await import("node:fs/promises")
    await mkdir(scratch, { mode: 0o700 })
    const command = (kind, extra = [], overrides = {}) => ({
      args: [
        resolve(
          `scripts/postgres-${kind === "backup" ? "logical-backup" : "restore-drill"}.mjs`
        ),
        ...(kind === "backup"
          ? ["--output-dir", output]
          : ["--archive", archive, "--manifest", manifestPath]),
        ...extra,
      ],
      env: {
        PATH: `${directory}:${process.env.PATH}`,
        TMPDIR: scratch,
        DATABASE_BACKUP_URL: sourceUrl,
        DATABASE_RESTORE_URL: targetUrl,
        DATABASE_RESTORE_CONFIRM: targetFingerprint,
        DATABASE_RECOVERY_TIMEOUT_MS: "3000",
        PGHOST: "unwanted-ambient-host",
        PGOPTIONS: "unwanted-ambient-options",
        UNRELATED_SECRET: "private-fixture-password",
        ...overrides,
      },
    })
    const configure = (config) =>
      writeFile(join(directory, "config.json"), JSON.stringify(config))
    const invoke = async (kind, config = {}, extra = [], overrides = {}) => {
      await configure(config)
      const input = command(kind, extra, overrides)
      const result = spawnSync(process.execPath, input.args, {
        env: input.env,
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      })
      assert.equal(result.error, undefined)
      assert.equal(result.signal, null)
      assert.doesNotMatch(
        result.stderr + result.stdout,
        /private-fixture-password|private-fixture-host|private-fixture-archive|unwanted-ambient/u
      )
      assert.deepEqual(await readdir(scratch), [])
      return result
    }
    const calls = async () =>
      (await readFile(join(directory, "calls.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map(JSON.parse)
    await run({
      directory,
      archive,
      manifestPath,
      output,
      scratch,
      command,
      configure,
      invoke,
      calls,
    })
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

for (const script of ["postgres-logical-backup", "postgres-restore-drill"]) {
  test(`${script} help works without credentials`, () => {
    const result = spawnSync(
      process.execPath,
      [resolve(`scripts/${script}.mjs`), "--help"],
      { env: {}, encoding: "utf8", timeout: 3000 }
    )
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /DATABASE_RECOVERY_TIMEOUT_MS/u)
    assert.match(result.stdout, /SIGINT\/SIGTERM/u)
  })
}

test("backup publishes private valid evidence only after archive verification", () =>
  withFixture(async ({ invoke, output, calls }) => {
    const result = await invoke("backup")
    assert.equal(result.status, 0, result.stderr)
    const evidence = JSON.parse(result.stdout)
    assert.equal(evidence.status, "verified")
    assert.equal(await readFile(evidence.archivePath, "utf8"), fixtureContent)
    const manifest = JSON.parse(await readFile(evidence.manifestPath, "utf8"))
    assert.equal(manifest.sha256, evidence.sha256)
    assert.equal(manifest.bytes, Buffer.byteLength(fixtureContent))
    for (const path of [evidence.archivePath, evidence.manifestPath])
      assert.equal((await stat(path)).mode & 0o777, 0o600)
    assert.equal((await readdir(output)).length, 2)
    for (const call of await calls()) {
      assert.equal(call.keys.includes("UNRELATED_SECRET"), false)
      assert.equal(call.keys.includes("DATABASE_BACKUP_URL"), false)
      assert.equal(call.keys.includes("PGOPTIONS"), false)
      assert.equal(call.host, "localhost")
      assert.equal(call.database, "source_fixture")
      assert.doesNotMatch(JSON.stringify(call.args), /fixture-password/u)
    }
  }))

for (const [name, config, overrides, phase] of [
  ["dump failure", { fail: "pg_dump" }, {}, "client_version"],
  ["invalid archive", { badList: true }, {}, "archive_verification"],
  [
    "deadline",
    { stall: "pg_dump" },
    { DATABASE_RECOVERY_TIMEOUT_MS: "750" },
    "dump",
  ],
])
  test(`backup rejects ${name} without publishing or leaking raw errors`, () =>
    withFixture(async ({ invoke, output }) => {
      const result = await invoke("backup", config, [], overrides)
      assert.equal(result.status, 1)
      assert.equal(JSON.parse(result.stderr).phase, phase)
      assert.equal(result.stdout, "")
      assert.deepEqual(await readdir(output), [])
    }))

test("restore dry-run verifies a private snapshot and never invokes mutating restore", () =>
  withFixture(async ({ invoke, calls, archive }) => {
    const result = await invoke("restore")
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).status, "dry_run_verified")
    const recorded = await calls()
    assert.deepEqual(
      recorded.map((call) => call.tool),
      ["pg_restore", "psql"]
    )
    assert.equal(recorded[0].args.includes("--list"), true)
    assert.notEqual(recorded[0].args.at(-1), archive)
    assert.equal(recorded[1].args.includes("--no-psqlrc"), true)
    assert.equal(recorded[1].args.includes("--quiet"), true)
    assert.match(
      recorded[1].args.at(-1),
      /BEGIN READ ONLY;\nSET LOCAL search_path = pg_catalog;/u
    )
  }))

test("restore applies the verified snapshot even if the original path changes", () =>
  withFixture(async ({ invoke, calls, directory, archive }) => {
    const result = await invoke("restore", { replaceSource: true }, ["--apply"])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).status, "restore_verified")
    assert.equal(
      await readFile(join(directory, "restored.dump"), "utf8"),
      fixtureContent
    )
    assert.notEqual(await readFile(archive, "utf8"), fixtureContent)
    const recorded = await calls()
    const mutation = recorded.find(
      (call) => call.tool === "pg_restore" && !call.args.includes("--list")
    )
    assert.equal(mutation.args.includes("--single-transaction"), true)
    assert.equal(mutation.args.includes("--clean"), false)
    assert.equal(mutation.args.includes("--create"), false)
    assert.equal(mutation.args.at(-1), recorded[0].args.at(-1))
  }))

for (const inventory of [
  { tables: 0, objects: 1 },
  { tables: 1, objects: 2 },
  "0garbage",
  { tables: "0", objects: 0 },
]) {
  test(`restore rejects unsafe target inventory ${JSON.stringify(inventory)}`, () =>
    withFixture(async ({ invoke, calls }) => {
      const result = await invoke("restore", { inventory }, ["--apply"])
      assert.equal(result.status, 1)
      assert.equal(JSON.parse(result.stderr).phase, "target_preflight")
      assert.equal(
        (await calls()).some(
          (call) => call.tool === "pg_restore" && !call.args.includes("--list")
        ),
        false
      )
    }))
}

for (const [name, config, overrides, phase] of [
  ["bad listing", { badList: true }, {}, "archive_verification"],
  ["restore command failure", { failRestore: true }, {}, "restore"],
  [
    "restore deadline",
    { stallRestore: true },
    { DATABASE_RECOVERY_TIMEOUT_MS: "1000" },
    "restore",
  ],
  [
    "missing restored tables",
    { afterInventory: { tables: 0, objects: 0 } },
    {},
    "target_verification",
  ],
  [
    "deadline",
    { stall: "psql" },
    { DATABASE_RECOVERY_TIMEOUT_MS: "750" },
    "target_preflight",
  ],
  [
    "wrong confirmation",
    {},
    { DATABASE_RESTORE_CONFIRM: "wrong" },
    "arguments",
  ],
  [
    "same endpoint",
    {},
    {
      DATABASE_RESTORE_URL: sourceUrl,
      DATABASE_RESTORE_CONFIRM: createPostgresClientEnvironment(
        sourceUrl,
        "fixture"
      ).fingerprint,
    },
    "archive_verification",
  ],
  [
    "snapshot budget",
    {},
    { DATABASE_RESTORE_MAX_ARCHIVE_BYTES: "1" },
    "archive_verification",
  ],
])
  test(`restore rejects ${name} without verified output`, () =>
    withFixture(async ({ invoke }) => {
      const result = await invoke("restore", config, ["--apply"], overrides)
      assert.equal(result.status, 1)
      assert.equal(JSON.parse(result.stderr).phase, phase)
      assert.equal(result.stdout, "")
    }))

test("backup SIGTERM cancels and reaps its database client before private cleanup", () =>
  withFixture(async ({ configure, command, directory, output }) => {
    await configure({ stall: "pg_dump" })
    const input = command("backup")
    const child = spawn(process.execPath, input.args, {
      env: input.env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stderr = ""
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    const completion = new Promise((resolve, reject) => {
      child.once("error", reject)
      child.once("close", (code, signal) => resolve({ code, signal }))
    })
    try {
      const pidPath = join(directory, "pid")
      let ready = false
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          await access(pidPath)
          ready = true
          break
        } catch {
          await delay(10)
        }
      }
      assert.equal(ready, true)
      child.kill("SIGTERM")
      assert.deepEqual(await completion, { code: 1, signal: null })
      assert.equal(JSON.parse(stderr).phase, "dump")
      const pid = Number(await readFile(pidPath, "utf8"))
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" })
      assert.deepEqual(await readdir(output), [])
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL")
      await completion
    }
  }))
