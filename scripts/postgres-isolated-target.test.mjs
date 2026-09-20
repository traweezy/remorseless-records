import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { constants } from "node:fs"
import {
  chmod,
  mkdir,
  mkdtemp,
  lstat,
  open,
  readFile,
  readdir,
  rm,
  symlink,
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
  createPhaseFailure,
  finishFailedCreate,
  isolatedTargetFailureEvent,
  main,
  parseArguments,
  readPrivateBoundedFile,
  readinessPhaseFailure,
  runCreatePhase,
  runBounded,
  verifySourceScope,
  waitForTargetReady,
  writeState,
} from "./postgres-isolated-target.mjs"

const scripts = fileURLToPath(new URL("./", import.meta.url))
const sourcePassword = "local_integration_only"
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")
const readStateMetadata = async (path) => {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await handle.stat()
    const state = JSON.parse(await handle.readFile("utf8"))
    return { mode: stat.mode & 0o777, state }
  } finally {
    await handle.close()
  }
}

test("private target reads are bounded and state replacement stays atomic", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "rr-target-file-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, "source.json")
  await writeFile(source, "trusted", { flag: "wx", mode: 0o600 })
  assert.equal((await readPrivateBoundedFile(source, 7)).toString(), "trusted")
  await assert.rejects(readPrivateBoundedFile(source, 6))
  const alias = join(root, "alias.json")
  await symlink(source, alias)
  await assert.rejects(readPrivateBoundedFile(alias, 7))
  await chmod(source, 0o644)
  await assert.rejects(readPrivateBoundedFile(source, 7))

  const statePath = join(root, "state.json")
  await writeState({ root, phase: "ready" })
  const savedState = await readStateMetadata(statePath)
  assert.equal(savedState.mode, 0o600)
  assert.equal(savedState.state.phase, "ready")
  const outside = join(root, "outside.json")
  await writeFile(outside, "untouched", { mode: 0o600 })
  await rm(statePath)
  await symlink(outside, statePath)
  await writeState({ root, phase: "restored" })
  assert.equal(await readFile(outside, "utf8"), "untouched")
  assert.equal((await readStateMetadata(statePath)).state.phase, "restored")
  assert.deepEqual(
    (await readdir(root)).filter((entry) => entry.startsWith(".state-")),
    []
  )
})
const stripeFixtureSql = `
CREATE TABLE public.cart (id text PRIMARY KEY, deleted_at timestamptz);
CREATE TABLE public."order" (id text PRIMARY KEY, deleted_at timestamptz);
CREATE TABLE public.payment_collection (id text PRIMARY KEY, amount numeric, authorized_amount numeric, captured_amount numeric, currency_code text, deleted_at timestamptz);
CREATE TABLE public.payment_session (id text PRIMARY KEY, payment_collection_id text, deleted_at timestamptz);
CREATE TABLE public.payment (id text PRIMARY KEY, amount numeric, currency_code text, provider_id text, data jsonb, payment_collection_id text, payment_session_id text, created_at timestamptz, deleted_at timestamptz);
CREATE TABLE public.capture (id text PRIMARY KEY, amount numeric, payment_id text, deleted_at timestamptz);
CREATE TABLE public.refund (id text PRIMARY KEY, amount numeric, payment_id text, deleted_at timestamptz);
CREATE TABLE public.order_cart (id text PRIMARY KEY, order_id text, cart_id text, deleted_at timestamptz);
CREATE TABLE public.order_payment_collection (id text PRIMARY KEY, order_id text, payment_collection_id text, deleted_at timestamptz);
CREATE TABLE public.cart_payment_collection (id text PRIMARY KEY, cart_id text, payment_collection_id text, deleted_at timestamptz);
CREATE TABLE public.tax_quote_evidences (id text PRIMARY KEY, cart_id text, order_id text, payment_intent_id text, amount_minor integer, currency_code text, status text, created_at timestamptz, deleted_at timestamptz);
CREATE TABLE public.stripe_lifecycle_events (id text PRIMARY KEY, payment_intent_id text, status text, livemode boolean, deleted_at timestamptz);
INSERT INTO public.cart VALUES ('cart_private_canary', NULL);
INSERT INTO public."order" VALUES ('order_private_canary', NULL);
INSERT INTO public.payment_collection VALUES ('paycol_private_canary', 25.00, 25.00, 25.00, 'usd', NULL);
INSERT INTO public.payment_session VALUES ('payses_private_canary', 'paycol_private_canary', NULL);
INSERT INTO public.payment VALUES ('pay_private_canary', 25.00, 'usd', 'pp_stripe_stripe', '{"id":"pi_privatecanary","amount":2500,"currency":"usd"}', 'paycol_private_canary', 'payses_private_canary', now(), NULL);
INSERT INTO public.capture VALUES ('cap_private_canary', 25.00, 'pay_private_canary', NULL);
INSERT INTO public.order_cart VALUES ('ordercart_private_canary', 'order_private_canary', 'cart_private_canary', NULL);
INSERT INTO public.order_payment_collection VALUES ('ordpay_private_canary', 'order_private_canary', 'paycol_private_canary', NULL);
INSERT INTO public.cart_payment_collection VALUES ('capaycol_private_canary', 'cart_private_canary', 'paycol_private_canary', NULL);
INSERT INTO public.tax_quote_evidences VALUES ('tax_private_canary', 'cart_private_canary', 'order_private_canary', 'pi_privatecanary', 2500, 'usd', 'succeeded', now(), NULL);
INSERT INTO public.stripe_lifecycle_events VALUES ('evt_private_canary', 'pi_privatecanary', 'processed', false, NULL);
`

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
  assert.deepEqual(
    parseArguments([
      "stripe-parity",
      "--target-dir",
      "/tmp/x",
      "--output",
      "/tmp/private/report.json",
    ]),
    {
      mode: "stripe-parity",
      options: {
        "--target-dir": "/tmp/x",
        "--output": "/tmp/private/report.json",
      },
    }
  )
  assert.throws(() =>
    parseArguments(["stripe-parity", "--target-dir", "/tmp/x"])
  )
})

test("create diagnostics expose only fixed subphases and preserve cleanup", async () => {
  const privateDetail = "private-password-and-target-path"
  const preRootArgs = [
    "create",
    "--base-dir",
    `/tmp/${privateDetail}-absent`,
    "--source-scope",
    "/tmp/absent/source-scope.receipt.json",
    "--archive",
    "/tmp/absent/database.dump",
    "--manifest",
    "/tmp/absent/database.manifest.json",
    "--receipt",
    "/tmp/absent/database.restore-receipt.json",
  ]
  await assert.rejects(main(preRootArgs), (error) => {
    assert.deepEqual(isolatedTargetFailureEvent(error), {
      status: "failed",
      phase: "isolated_target",
      subphase: "base_directory",
    })
    return true
  })
  assert.deepEqual(isolatedTargetFailureEvent(new Error(privateDetail)), {
    status: "failed",
    phase: "isolated_target",
  })
  assert.throws(() => createPhaseFailure(privateDetail))

  let provisioningFailure
  try {
    await runCreatePhase("volume_create", async () => {
      throw new Error(privateDetail)
    })
  } catch (error) {
    provisioningFailure = error
  }
  assert.ok(provisioningFailure)
  let cleaned = false
  await assert.rejects(
    finishFailedCreate(provisioningFailure, async () => {
      cleaned = true
    }),
    (error) => {
      assert.equal(error, provisioningFailure)
      assert.deepEqual(isolatedTargetFailureEvent(error), {
        status: "failed",
        phase: "isolated_target",
        subphase: "volume_create",
      })
      return true
    }
  )
  assert.equal(cleaned, true)
  await assert.rejects(
    finishFailedCreate(provisioningFailure, async () => {
      throw new Error(privateDetail)
    }),
    (error) => {
      assert.deepEqual(isolatedTargetFailureEvent(error), {
        status: "failed",
        phase: "isolated_target",
        subphase: "cleanup",
      })
      assert.ok(
        !JSON.stringify(isolatedTargetFailureEvent(error)).includes(
          privateDetail
        )
      )
      return true
    }
  )
})

test("CLI failure event adds only the allowlisted create subphase", async () => {
  const runCli = async (args) => {
    const child = spawn(
      process.execPath,
      [join(scripts, "postgres-isolated-target.mjs"), ...args],
      { env: privateEnvironment(), stdio: ["ignore", "pipe", "pipe"] }
    )
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8")
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8")
    })
    const code = await new Promise((resolve) => child.once("close", resolve))
    assert.equal(code, 1)
    assert.equal(stdout, "")
    return stderr
  }
  const secretMarker = "private-secret-marker"
  const createError = await runCli([
    "create",
    "--base-dir",
    `/tmp/${secretMarker}-absent`,
    "--source-scope",
    "/tmp/absent/source-scope.receipt.json",
    "--archive",
    "/tmp/absent/database.dump",
    "--manifest",
    "/tmp/absent/database.manifest.json",
    "--receipt",
    "/tmp/absent/database.restore-receipt.json",
  ])
  assert.equal(
    createError,
    '{"status":"failed","phase":"isolated_target","subphase":"base_directory"}\n'
  )
  assert.ok(!createError.includes(secretMarker))
  assert.equal(
    await runCli(["unsupported"]),
    '{"status":"failed","phase":"isolated_target"}\n'
  )
})

test("owned PostgreSQL readiness waits for acceptance before full verification", async () => {
  let clock = 0
  let socketChecks = 0
  let probes = 0
  await waitForTargetReady("/tmp/owned-socket", {
    now: () => clock,
    timeoutMs: 500,
    socketAvailable: async (path) => {
      assert.equal(path, "/tmp/owned-socket/.s.PGSQL.5432")
      socketChecks += 1
      return socketChecks > 1
    },
    probe: async (command, args, options) => {
      assert.equal(command, "/usr/lib/postgresql/16/bin/pg_isready")
      assert.deepEqual(args, [
        "--quiet",
        "--host",
        "/tmp/owned-socket",
        "--port",
        "5432",
        "--username",
        "postgres",
        "--dbname",
        "postgres",
        "--timeout",
        "1",
      ])
      assert.equal(options.maxBytes, 0)
      assert.ok(options.timeoutMs <= 500 - clock)
      probes += 1
      if (probes === 1) throw new Error("Synthetic startup rejection.")
    },
    pause: async (milliseconds) => {
      clock += milliseconds
    },
  })
  assert.equal(socketChecks, 3)
  assert.equal(probes, 2)
  assert.equal(clock, 200)
})

test("owned PostgreSQL readiness has one total deadline and redacted phase", async () => {
  let clock = 0
  let probes = 0
  await assert.rejects(
    runCreatePhase("server_readiness", () =>
      waitForTargetReady("/tmp/owned-socket", {
        now: () => clock,
        timeoutMs: 250,
        socketAvailable: async () => true,
        probe: async () => {
          probes += 1
          throw new Error("Synthetic private database error.")
        },
        pause: async (milliseconds) => {
          clock += milliseconds
        },
      })
    ),
    (error) => {
      assert.deepEqual(isolatedTargetFailureEvent(error), {
        status: "failed",
        phase: "isolated_target",
        subphase: "server_readiness",
      })
      return true
    }
  )
  assert.equal(clock, 250)
  assert.equal(probes, 3)
  await assert.rejects(
    waitForTargetReady("/tmp/owned-socket", {
      socketAvailable: async () => {
        throw new Error("Unexpected socket ownership.")
      },
      now: () => 0,
      timeoutMs: 100,
    }),
    /Unexpected socket ownership/u
  )
})

test("readiness diagnosis only reports fixed timeout and owned container states", async () => {
  const privateDetail = "private-password-and-target-path"
  const state = {
    containerId: "c".repeat(64),
    containerName: `rr-pg16-target-${"a".repeat(32)}`,
    owner: "a".repeat(32),
  }
  const inspected = (running, oomKilled = false) => ({
    Id: state.containerId,
    Name: `/${state.containerName}`,
    Image:
      "sha256:76db58e52e571729aa4ab51a5c597189e6f570086345c29b68b358067a6547e8",
    Config: {
      Labels: { "com.remorseless.recovery.target": state.owner },
      User: "999:999",
    },
    HostConfig: { NetworkMode: "none" },
    State: { Running: running, OOMKilled: oomKilled },
  })
  const timedOut = async (socketAvailable) => {
    let clock = 0
    try {
      await waitForTargetReady("/tmp/owned-socket", {
        now: () => clock,
        timeoutMs: 250,
        socketAvailable,
        probe: async () => {
          throw new Error(privateDetail)
        },
        pause: async (milliseconds) => {
          clock += milliseconds
        },
      })
      assert.fail("Expected bounded readiness timeout.")
    } catch (error) {
      assert.equal(clock, 250)
      return error
    }
  }
  const noSocket = await timedOut(async () => false)
  const noSocketFailure = await readinessPhaseFailure(noSocket, state, {
    inspectContainer: async () => inspected(false),
  })
  assert.deepEqual(isolatedTargetFailureEvent(noSocketFailure), {
    status: "failed",
    phase: "isolated_target",
    subphase: "server_readiness",
    reason: "socket_never_seen",
    containerState: "exited",
  })
  const rejected = await timedOut(async () => true)
  const rejectedFailure = await readinessPhaseFailure(rejected, state, {
    inspectContainer: async () => inspected(true),
  })
  assert.deepEqual(isolatedTargetFailureEvent(rejectedFailure), {
    status: "failed",
    phase: "isolated_target",
    subphase: "server_readiness",
    reason: "probe_rejected",
    containerState: "running",
  })
  const oomFailure = await readinessPhaseFailure(rejected, state, {
    inspectContainer: async () => inspected(false, true),
  })
  assert.equal(
    isolatedTargetFailureEvent(oomFailure).containerState,
    "oom_killed"
  )
  const unownedFailure = await readinessPhaseFailure(rejected, state, {
    inspectContainer: async () => ({
      ...inspected(false),
      Config: { Labels: {}, User: "999:999" },
    }),
  })
  assert.equal(
    isolatedTargetFailureEvent(unownedFailure).containerState,
    "unknown"
  )
  const boundaryFailure = await readinessPhaseFailure(
    new Error(privateDetail),
    state,
    { inspectContainer: async () => inspected(true) }
  )
  assert.equal(
    isolatedTargetFailureEvent(boundaryFailure).reason,
    "boundary_rejected"
  )
  assert.ok(
    !JSON.stringify(isolatedTargetFailureEvent(boundaryFailure)).includes(
      privateDetail
    )
  )
  assert.throws(() =>
    createPhaseFailure("server_readiness", {
      reason: privateDetail,
      containerState: "running",
    })
  )
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
    await sourceQuery(stripeFixtureSql)
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
        projectId: "1f39263a-25e4-4d69-abc2-f0287b331d1e",
        environmentId: "799a2f98-f819-495d-b8b6-12e71af86568",
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
    const stripeEnvironment = {
      STRIPE_API_KEY: "sk_test_synthetic_canary",
      RR_STRIPE_EXPECTED_ACCOUNT_ID: "acct_syntheticcanary",
      RAILWAY_PROJECT_ID: "1f39263a-25e4-4d69-abc2-f0287b331d1e",
      RAILWAY_ENVIRONMENT_ID: "799a2f98-f819-495d-b8b6-12e71af86568",
      RAILWAY_SERVICE_ID: "99d4fd5e-955b-416a-9078-0266bcf949d2",
      RAILWAY_SERVICE_NAME: "Backend",
    }
    const previousEnvironment = Object.fromEntries(
      Object.keys(stripeEnvironment).map((key) => [key, process.env[key]])
    )
    const stripeOutput = join(fixture, "stripe-parity.json")
    try {
      Object.assign(process.env, stripeEnvironment)
      const stripeResult = await main(
        ["stripe-parity", "--target-dir", target, "--output", stripeOutput],
        {
          runStripeRead: async (records) => {
            assert.equal(records.length, 1)
            return {
              schemaVersion: 1,
              source: "provided_private_descriptor_and_stripe_test_mode",
              readOnly: true,
              accountVerified: true,
              testModeVerified: true,
              businessReconciled: false,
              scanned: {
                paymentIntents: 1,
                taxEvidencePairs: 1,
                missingTaxEvidence: 0,
                archivedProviderAmounts: 1,
                archivedProviderCurrencies: 1,
              },
              mismatches: {
                medusaAmount: 0,
                medusaCurrency: 0,
                providerAmount: 0,
                providerCurrency: 0,
                taxAmount: 0,
                taxCurrency: 0,
              },
            }
          },
        }
      )
      assert.equal(stripeResult.status, "stripe_parity_reported")
      assert.equal(stripeResult.businessReconciled, false)
      const report = JSON.parse(await readFile(stripeOutput, "utf8"))
      assert.equal(report.scanned.paymentIntents, 1)
      assert.equal(
        report.source,
        "verified_isolated_postgres_restore_and_stripe_test_mode"
      )
      assert.equal(
        report.sourceScopeSha256,
        sha256(await readFile(sourceScopePath))
      )
      assert.equal((await lstat(stripeOutput)).mode & 0o077, 0)
      const raw = JSON.stringify(report)
      assert.ok(!raw.includes("pi_privatecanary"))
      assert.ok(!raw.includes("acct_syntheticcanary"))
      assert.ok(!raw.includes("sk_test_synthetic_canary"))
    } finally {
      for (const [key, value] of Object.entries(previousEnvironment)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
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
