import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { createPostgresClientEnvironment } from "./lib/postgres-logical-backup.mjs"
import {
  assertContainerBoundary,
  main,
  parseArguments,
  runBounded,
  verifySourceScope,
} from "./postgres-isolated-target.mjs"

const scripts = fileURLToPath(new URL("./", import.meta.url))
const sourcePassword = "local_integration_only"
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")

const freePort = async () => {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  await new Promise((resolve) => server.close(resolve))
  assert.ok(address && typeof address !== "string")
  return address.port
}

const privateEnvironment = (additional = {}) => ({
  PATH: "/usr/lib/postgresql/16/bin:/usr/bin:/bin",
  LANG: "C",
  ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
  ...additional,
})

test("isolated target arguments reject missing, extra and implicit apply flags", () => {
  assert.deepEqual(parseArguments(["--help"]), { mode: "help" })
  assert.deepEqual(parseArguments(["--", "--help"]), { mode: "help" })
  assert.deepEqual(parseArguments(["--", "verify", "--target-dir", "/tmp/x"]), {
    mode: "verify",
    options: { "--target-dir": "/tmp/x" },
  })
  assert.throws(() => parseArguments(["--", "--", "--help"]))
  assert.throws(() => parseArguments(["apply", "--target-dir", "/tmp/x"]))
  assert.throws(() =>
    parseArguments(["cleanup", "--target-dir", "/tmp/x", "--force", "1"])
  )
  assert.throws(() => parseArguments(["create", "--base-dir", "/tmp/x"]))
})

test("bounded command hides child stderr and fails on deadline", async () => {
  await assert.rejects(
    runBounded(process.execPath, [
      "-e",
      "process.stderr.write('private'); process.exit(1)",
    ])
  )
  await assert.rejects(
    runBounded(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], {
      timeoutMs: 100,
    })
  )
  const startedAt = Date.now()
  await assert.rejects(
    runBounded(
      process.execPath,
      ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
      { timeoutMs: 100, killSignal: "SIGTERM", terminationGraceMs: 100 }
    )
  )
  assert.ok(Date.now() - startedAt < 2000)
})

test("pinned isolated target restores only a hash-bound synthetic source", {
  skip: process.env.PG_ISOLATED_TARGET_TESTS_ENABLED !== "1",
  timeout: 120_000,
}, async () => {
  const fixture = await mkdtemp(join(tmpdir(), "rr-pg16-target-test-"))
  const source = join(fixture, "source")
  const base = join(fixture, "targets")
  const bundleParent = join(fixture, "bundles")
  const sourcePort = await freePort()
  const sourceUrl = `postgresql://postgres:${sourcePassword}@127.0.0.1:${sourcePort}/postgres?sslmode=disable`
  const sourceEnvironment = privateEnvironment({
    PGHOST: "127.0.0.1",
    PGPORT: String(sourcePort),
    PGUSER: "postgres",
    PGPASSWORD: sourcePassword,
    PGDATABASE: "postgres",
    PGSSLMODE: "disable",
    PGCONNECT_TIMEOUT: "5",
  })
  let target
  let started = false
  try {
    await mkdir(source, { mode: 0o700 })
    await mkdir(base, { mode: 0o700 })
    await mkdir(bundleParent, { mode: 0o700 })
    await writeFile(join(source, "password"), `${sourcePassword}\n`, {
      mode: 0o600,
    })
    await runBounded(
      "/usr/lib/postgresql/16/bin/initdb",
      [
        "-D",
        join(source, "data"),
        "-U",
        "postgres",
        `--pwfile=${join(source, "password")}`,
        "--auth-host=scram-sha-256",
        "--auth-local=trust",
        "--locale=en_US.utf8",
        "--encoding=UTF8",
        "--no-instructions",
      ],
      { timeoutMs: 30_000 }
    )
    await runBounded(
      "/usr/lib/postgresql/16/bin/pg_ctl",
      [
        "-D",
        join(source, "data"),
        "-l",
        join(source, "server.log"),
        "-o",
        `-h 127.0.0.1 -p ${sourcePort} -k ${source}`,
        "-w",
        "start",
      ],
      { timeoutMs: 15_000 }
    )
    started = true
    const sourceQuery = (sql) =>
      runBounded(
        "/usr/lib/postgresql/16/bin/psql",
        [
          "--no-psqlrc",
          "--no-password",
          "--quiet",
          "--tuples-only",
          "--no-align",
          `--command=${sql}`,
        ],
        { environment: sourceEnvironment }
      )
    await sourceQuery(
      "CREATE SCHEMA app; CREATE TABLE app.items (id integer PRIMARY KEY, name text NOT NULL); INSERT INTO app.items VALUES (1, 'synthetic')"
    )
    const sourceSystemId = await sourceQuery(
      "SELECT system_identifier FROM pg_catalog.pg_control_system()"
    )
    const backup = JSON.parse(
      await runBounded(
        process.execPath,
        [
          join(scripts, "postgres-snapshot-backup.mjs"),
          "--output-dir",
          bundleParent,
        ],
        {
          environment: privateEnvironment({
            DATABASE_BACKUP_URL: sourceUrl,
            DATABASE_RECOVERY_TIMEOUT_MS: "30000",
          }),
          timeoutMs: 35_000,
        }
      )
    )
    const bundle = join(bundleParent, backup.archivePath.split("/").at(-2))
    const sourceScopePath = join(bundle, "source-scope.receipt.json")
    const manifest = JSON.parse(await readFile(backup.manifestPath, "utf8"))
    const uuid = () => randomUUID()
    const scope = {
      schemaVersion: 1,
      source: {
        projectId: uuid(),
        environmentId: uuid(),
        serviceId: uuid(),
        serviceInstanceId: uuid(),
        deploymentId: uuid(),
        deploymentInstanceId: uuid(),
        volumeInstanceId: uuid(),
        volumeId: uuid(),
        volumeMountPath: "/var/lib/postgresql/data",
      },
      sourceSystemId,
      originalEndpointFingerprint: "a".repeat(64),
      mappedEndpointFingerprint: createPostgresClientEnvironment(
        sourceUrl,
        "synthetic"
      ).fingerprint,
      archiveSha256: manifest.sha256,
      manifestSha256: sha256(await readFile(backup.manifestPath)),
      restoreReceiptSha256: sha256(await readFile(backup.receiptPath)),
      sourceMajor: 16,
      tunnelHost: "ssh.railway.com",
      tunnelTlsMode: "require",
      capturedAt: new Date().toISOString(),
    }
    assert.notEqual(
      scope.originalEndpointFingerprint,
      scope.mappedEndpointFingerprint
    )
    await writeFile(sourceScopePath, `${JSON.stringify(scope)}\n`, {
      flag: "wx",
      mode: 0o600,
    })
    const paths = {
      sourceScopePath,
      archivePath: backup.archivePath,
      manifestPath: backup.manifestPath,
      receiptPath: backup.receiptPath,
    }
    await verifySourceScope(paths)
    const createArgs = [
      "create",
      "--base-dir",
      base,
      "--source-scope",
      sourceScopePath,
      "--archive",
      backup.archivePath,
      "--manifest",
      backup.manifestPath,
      "--receipt",
      backup.receiptPath,
    ]
    const created = await main(createArgs)
    target = created.targetDir
    assert.equal(created.status, "isolated_target_ready")
    assert.notEqual(created.targetSystemId, sourceSystemId)
    assert.equal(
      (await main(["verify", "--target-dir", target])).status,
      "isolated_target_verified"
    )

    const state = JSON.parse(await readFile(join(target, "state.json"), "utf8"))
    const container = JSON.parse(
      await runBounded("docker", [
        "--context",
        "default",
        "container",
        "inspect",
        state.containerName,
      ])
    )[0]
    const volume = JSON.parse(
      await runBounded("docker", [
        "--context",
        "default",
        "volume",
        "inspect",
        state.volumeName,
      ])
    )[0]
    assert.doesNotThrow(() => assertContainerBoundary(state, container, volume))
    assert.throws(() =>
      assertContainerBoundary(
        state,
        { ...container, Image: "sha256:" + "0".repeat(64) },
        volume
      )
    )
    assert.throws(() =>
      assertContainerBoundary(state, { ...container, Mounts: [] }, volume)
    )
    assert.throws(() =>
      assertContainerBoundary(state, container, {
        ...volume,
        Labels: {
          ...volume.Labels,
          "com.remorseless.recovery.target": "0".repeat(32),
        },
      })
    )
    assert.throws(() =>
      assertContainerBoundary(
        state,
        {
          ...container,
          HostConfig: { ...container.HostConfig, NetworkMode: "bridge" },
        },
        volume
      )
    )

    const originalScope = await readFile(sourceScopePath)
    await writeFile(sourceScopePath, `${originalScope.toString("utf8")} `)
    await assert.rejects(main(["verify", "--target-dir", target]))
    await writeFile(sourceScopePath, originalScope)
    const originalReceipt = await readFile(backup.receiptPath)
    await writeFile(backup.receiptPath, `${originalReceipt.toString("utf8")} `)
    await assert.rejects(main(["preflight", "--target-dir", target]))
    await writeFile(backup.receiptPath, originalReceipt)

    const targetPassword = (
      await readFile(join(target, "password"), "utf8")
    ).trim()
    const targetEnvironment = privateEnvironment({
      PGHOST: join(target, "socket"),
      PGPORT: "5432",
      PGUSER: "postgres",
      PGPASSWORD: targetPassword,
      PGDATABASE: "postgres",
      PGSSLMODE: "disable",
    })
    const targetQuery = (sql) =>
      runBounded(
        "/usr/lib/postgresql/16/bin/psql",
        [
          "--no-psqlrc",
          "--no-password",
          "--quiet",
          "--tuples-only",
          "--no-align",
          `--command=${sql}`,
        ],
        { environment: targetEnvironment }
      )
    await targetQuery("CREATE TABLE public.must_be_empty (id integer)")
    await assert.rejects(main(["verify", "--target-dir", target]))
    await targetQuery("DROP TABLE public.must_be_empty")

    const originalArchive = await readFile(backup.archivePath)
    const preflight = await main(["preflight", "--target-dir", target], {
      runRestoreCommand: async (command, args, options) => {
        assert.notEqual(args[args.indexOf("--archive") + 1], backup.archivePath)
        await writeFile(
          backup.archivePath,
          Buffer.concat([originalArchive, Buffer.from("changed")])
        )
        try {
          return await runBounded(command, args, options)
        } finally {
          await writeFile(backup.archivePath, originalArchive)
        }
      },
    })
    assert.equal(preflight.status, "isolated_preflight_verified")
    assert.match(preflight.confirmation, /^[a-f0-9]{64}$/u)
    assert.equal(
      (await readdir(target)).filter((name) =>
        name.startsWith(".restore-input-")
      ).length,
      0
    )
    await assert.rejects(
      main(["apply", "--target-dir", target, "--confirm", "0".repeat(64)])
    )
    const applied = await main([
      "apply",
      "--target-dir",
      target,
      "--confirm",
      preflight.confirmation,
    ])
    assert.equal(applied.status, "isolated_restore_verified")
    assert.equal(await targetQuery("SELECT count(*) FROM app.items"), "1")
    assert.equal(
      (await main(["verify", "--target-dir", target])).status,
      "isolated_restored_target_verified"
    )
    await targetQuery("DELETE FROM app.items")
    await assert.rejects(main(["verify", "--target-dir", target]))
    await targetQuery("INSERT INTO app.items VALUES (1, 'synthetic')")
    assert.equal(
      (await main(["verify", "--target-dir", target])).status,
      "isolated_restored_target_verified"
    )
    await assert.rejects(
      main([
        "apply",
        "--target-dir",
        target,
        "--confirm",
        preflight.confirmation,
      ])
    )
    const lockHolder = spawn(
      "/usr/bin/flock",
      [
        "--nonblock",
        "--no-fork",
        target,
        "/bin/sh",
        "-c",
        "echo ready; cat >/dev/null",
      ],
      { stdio: ["pipe", "pipe", "ignore"] }
    )
    try {
      assert.equal(
        await new Promise((resolve) =>
          lockHolder.stdout.once("data", (chunk) => resolve(chunk.toString()))
        ),
        "ready\n"
      )
      await assert.rejects(main(["cleanup", "--target-dir", target]))
    } finally {
      lockHolder.stdin.end()
      await new Promise((resolve) => lockHolder.once("close", resolve))
    }
    const originalState = await readFile(join(target, "state.json"))
    const forgedState = JSON.parse(originalState.toString("utf8"))
    forgedState.owner = randomUUID().replaceAll("-", "")
    forgedState.containerName = `rr-pg16-target-${forgedState.owner}`
    forgedState.volumeName = forgedState.containerName
    await writeFile(
      join(target, "state.json"),
      `${JSON.stringify(forgedState)}\n`
    )
    await assert.rejects(main(["cleanup", "--target-dir", target]))
    await writeFile(join(target, "state.json"), originalState)
    const removed = await main(["cleanup", "--target-dir", target])
    target = undefined
    assert.equal(removed.status, "isolated_target_removed")
    const remains = await runBounded("docker", [
      "--context",
      "default",
      "container",
      "ls",
      "--all",
      "--filter",
      `name=^/${state.containerName}$`,
      "--format",
      "{{.ID}}",
    ])
    assert.equal(remains, "")
    const volumeRemains = await runBounded("docker", [
      "--context",
      "default",
      "volume",
      "ls",
      "--filter",
      `name=^${state.volumeName}$`,
      "--format",
      "{{.Name}}",
    ])
    assert.equal(volumeRemains, "")

    const cancellationTarget = await main(createArgs)
    target = cancellationTarget.targetDir
    const cancellationPreflight = await main([
      "preflight",
      "--target-dir",
      target,
    ])
    const controller = new AbortController()
    const cancellationArgs = [
      "apply",
      "--target-dir",
      target,
      "--confirm",
      cancellationPreflight.confirmation,
    ]
    await assert.rejects(
      main(cancellationArgs, {
        signal: controller.signal,
        runRestoreCommand: async () => {
          controller.abort()
          throw new Error("Synthetic restore cancellation.")
        },
      })
    )
    const cancelledState = JSON.parse(
      await readFile(join(target, "state.json"), "utf8")
    )
    assert.equal(cancelledState.phase, "restore_attempted")
    await assert.rejects(main(cancellationArgs))
    assert.equal(
      (await main(["cleanup", "--target-dir", target])).status,
      "isolated_target_removed"
    )
    target = undefined
  } finally {
    if (target) await main(["cleanup", "--target-dir", target])
    if (started)
      await runBounded(
        "/usr/lib/postgresql/16/bin/pg_ctl",
        ["-D", join(source, "data"), "-m", "immediate", "stop"],
        { timeoutMs: 15_000 }
      )
    await rm(fixture, { recursive: true, force: true })
  }
})
