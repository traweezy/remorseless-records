import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import {
  buildSshArguments,
  normalizeRailwayScope,
  parseRemoteScope,
  parseSnapshotFailurePhase,
  parseSourceConnection,
  runPrivateCommand,
  runStagingSnapshot,
  selectSourceUrl,
  stagingFailureRecord,
  startScopeTunnel,
} from "./postgres-staging-snapshot.mjs"

const ids = {
  project: "11111111-1111-4111-8111-111111111111",
  environment: "22222222-2222-4222-8222-222222222222",
  service: "33333333-3333-4333-8333-333333333333",
  deployment: "44444444-4444-4444-8444-444444444444",
  replica: "55555555-5555-4555-8555-555555555555",
  volumeInstance: "66666666-6666-4666-8666-666666666666",
  volume: "77777777-7777-4777-8777-777777777777",
  serviceInstance: "88888888-8888-4888-8888-888888888888",
}
const originalUrl =
  "postgresql://railway:fake-private-password@db.proxy.rlwy.net:51985/railway"
const args = (output) => [
  "--project-id",
  ids.project,
  "--environment-id",
  ids.environment,
  "--service-id",
  ids.service,
  "--deployment-id",
  ids.deployment,
  "--deployment-instance-id",
  ids.replica,
  "--volume-instance-id",
  ids.volumeInstance,
  "--volume-id",
  ids.volume,
  "--output-dir",
  output,
]
const flags = Object.fromEntries(
  args("/tmp/private").reduce((pairs, value, index, values) => {
    if (index % 2 === 0) pairs.push([value, values[index + 1]])
    return pairs
  }, [])
)
const apiScope = () => ({
  data: {
    serviceInstance: {
      id: ids.serviceInstance,
      environmentId: ids.environment,
      serviceId: ids.service,
      activeDeployments: [
        {
          id: ids.deployment,
          projectId: ids.project,
          environmentId: ids.environment,
          serviceId: ids.service,
          status: "SUCCESS",
          instances: [{ id: ids.replica, status: "RUNNING" }],
        },
      ],
    },
    volumeInstance: {
      id: ids.volumeInstance,
      volumeId: ids.volume,
      environmentId: ids.environment,
      serviceId: ids.service,
      mountPath: "/var/lib/postgresql/data",
      state: "READY",
      deletedAt: null,
      isPendingDeletion: false,
      environment: {
        id: ids.environment,
        projectId: ids.project,
        name: "staging",
      },
    },
  },
})
const sha = (value) => createHash("sha256").update(value).digest("hex")
const systemId = "12345678901234567890"

const fixture = async (run) => {
  const root = await mkdtemp(join(tmpdir(), "rr-staging-snapshot-test-"))
  try {
    const sshDirectory = join(root, ".ssh")
    await mkdir(sshDirectory, { mode: 0o700 })
    await writeFile(
      join(sshDirectory, "known_hosts"),
      "ssh.railway.com ssh-ed25519 TEST\n",
      {
        mode: 0o600,
      }
    )
    const environment = {
      HOME: root,
      PATH: process.env.PATH,
      DATABASE_BACKUP_URL: originalUrl,
      RAILWAY_TOKEN: "fake-api-token",
      DATABASE_RECOVERY_TIMEOUT_MS: "10000",
    }
    return await run({ root, output: join(root, "out"), environment })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const createFake = ({
  drift = false,
  tamper = false,
  backupFailure = false,
  backupFailurePhase,
  closeFailure = false,
  cancel = false,
} = {}) => {
  let reads = 0
  let closed = false
  const exited = new AbortController()
  const tunnelFactory = async ({ args: sshArgs, scope, environment }) => {
    assert.ok(sshArgs.includes("StrictHostKeyChecking=yes"))
    assert.ok(sshArgs.includes("BatchMode=yes"))
    assert.ok(sshArgs.includes(`${ids.serviceInstance}@ssh.railway.com`))
    assert.equal(scope.deploymentInstanceId, ids.replica)
    assert.equal(environment.RAILWAY_TOKEN, undefined)
    return {
      exitSignal: exited.signal,
      assertOpen: () => assert.ok(!closed && !exited.signal.aborted),
      close: async () => {
        closed = true
        if (closeFailure) throw Error("private tunnel close failed")
      },
    }
  }
  const command = async (executable, commandArgs, options) => {
    if (executable === "ssh-keygen") {
      assert.equal(options.environment.RAILWAY_TOKEN, undefined)
      return "# known host"
    }
    if (executable === "railway") {
      assert.equal(options.environment.RAILWAY_TOKEN, "fake-api-token")
      reads++
      const scope = apiScope()
      if (drift && reads === 2) scope.data.volumeInstance.state = "DETACHED"
      return JSON.stringify(scope)
    }
    if (executable === "psql") {
      assert.equal(options.environment.PGHOST, "127.0.0.1")
      assert.equal(options.environment.PGSSLMODE, "require")
      assert.equal(options.environment.PGPASSWORD, "fake-private-password")
      return systemId
    }
    assert.equal(executable, process.execPath)
    assert.equal(
      options.environment.DATABASE_BACKUP_URL.includes("127.0.0.1"),
      true
    )
    assert.equal(options.environment.DATABASE_URL, undefined)
    assert.equal(options.environment.RAILWAY_TOKEN, undefined)
    if (cancel) {
      exited.abort()
      throw new Error("capture cancelled")
    }
    if (backupFailure || backupFailurePhase) {
      const failure = new Error("simulated backup failure")
      failure.snapshotFailurePhase = backupFailurePhase
      throw failure
    }
    const parent = commandArgs.at(-1)
    const bundle = join(parent, "postgres-snapshot-fake")
    await mkdir(bundle, { mode: 0o700 })
    const archive = Buffer.from("isolated-fixture-archive")
    const hash = sha(archive)
    const fingerprint = parseSourceConnection(
      originalUrl,
      55321
    ).mappedFingerprint
    const mapped = new URL(options.environment.DATABASE_BACKUP_URL)
    const actualFingerprint = sha(`127.0.0.1:${mapped.port}/railway`)
    assert.equal(fingerprint.length, actualFingerprint.length)
    const manifest = {
      schemaVersion: 1,
      bytes: archive.length,
      createdAt: new Date().toISOString(),
      format: "postgres-custom",
      pgDumpVersion: "pg_dump (PostgreSQL) 16.15",
      sha256: hash,
      sourceFingerprint: actualFingerprint,
    }
    const receipt = {
      schemaVersion: 1,
      archiveSha256: hash,
      sourceFingerprint: tamper ? sha("wrong") : actualFingerprint,
      invariants: {
        serverMajor: 16,
        counts: {
          constraints: 1,
          indexes: 1,
          routines: 0,
          sequences: 0,
          tables: 1,
          views: 0,
        },
        tableRows: [{ schema: "public", table: "items", rows: 3 }],
      },
    }
    await writeFile(join(bundle, "database.dump"), archive, { mode: 0o600 })
    await writeFile(
      join(bundle, "database.manifest.json"),
      JSON.stringify(manifest),
      {
        mode: 0o600,
      }
    )
    await writeFile(
      join(bundle, "database.restore-receipt.json"),
      JSON.stringify(receipt),
      {
        mode: 0o600,
      }
    )
    return JSON.stringify({
      status: "snapshot_bundle_verified",
      sha256: hash,
      sourceMajor: 16,
      archivePath: join(bundle, "database.dump"),
      manifestPath: join(bundle, "database.manifest.json"),
      receiptPath: join(bundle, "database.restore-receipt.json"),
    })
  }
  return {
    command,
    tunnelFactory,
    get closed() {
      return closed
    },
    get reads() {
      return reads
    },
  }
}

test("binds a private published bundle to exact source and system identity", async () => {
  await fixture(async ({ output, environment }) => {
    const fake = createFake()
    const railwayEnvironment = {
      ...environment,
      DATABASE_BACKUP_URL: undefined,
      DATABASE_URL: originalUrl,
      RAILWAY_PROJECT_ID: ids.project,
      RAILWAY_ENVIRONMENT_ID: ids.environment,
      RAILWAY_SERVICE_ID: ids.service,
    }
    const result = await runStagingSnapshot(args(output), {
      environment: railwayEnvironment,
      command: fake.command,
      tunnelFactory: fake.tunnelFactory,
      portAllocator: async () => 55321,
    })
    assert.equal(result.status, "staging_snapshot_bound")
    assert.equal(fake.reads, 2)
    assert.equal(fake.closed, true)
    const names = await readdir(output)
    assert.equal(names.length, 1)
    const scope = JSON.parse(await readFile(result.sourceScopePath, "utf8"))
    assert.equal(scope.sourceSystemId, systemId)
    assert.equal(scope.source.projectId, ids.project)
    assert.equal(scope.source.deploymentInstanceId, ids.replica)
    assert.equal(scope.tunnelTlsMode, "require")
    assert.notEqual(
      scope.originalEndpointFingerprint,
      scope.mappedEndpointFingerprint
    )
    assert.equal(scope.archiveSha256, sha(await readFile(result.archivePath)))
    assert.equal(scope.manifestSha256, sha(await readFile(result.manifestPath)))
    assert.equal(
      scope.restoreReceiptSha256,
      sha(await readFile(result.receiptPath))
    )
    assert.ok(
      !JSON.stringify({ result, scope }).includes("fake-private-password")
    )
    assert.ok(!JSON.stringify({ result, scope }).includes("fake-api-token"))
    assert.ok(!JSON.stringify({ result, scope }).includes("db.proxy.rlwy.net"))
  })
})

for (const [label, options] of [
  ["postflight volume drift", { drift: true }],
  ["tampered restore receipt", { tamper: true }],
  ["capture failure", { backupFailure: true }],
  ["tunnel cleanup failure", { closeFailure: true }],
  ["tunnel cancellation", { cancel: true }],
]) {
  test(`fails closed and removes artifacts after ${label}`, async () => {
    await fixture(async ({ output, environment }) => {
      const fake = createFake(options)
      await assert.rejects(
        runStagingSnapshot(args(output), {
          environment,
          command: fake.command,
          tunnelFactory: fake.tunnelFactory,
          portAllocator: async () => 55321,
        })
      )
      assert.equal(fake.closed, true)
      assert.deepEqual(await readdir(output), [])
    })
  })
}

test("rejects ambiguous or unguarded source variables and unverifiable TLS", async () => {
  await fixture(async ({ output, environment }) => {
    const input = Object.fromEntries(
      args(output).reduce((pairs, value, index, values) => {
        if (index % 2 === 0) pairs.push([value, values[index + 1]])
        return pairs
      }, [])
    )
    assert.throws(() =>
      selectSourceUrl({ ...environment, DATABASE_URL: originalUrl }, input)
    )
    assert.throws(() =>
      selectSourceUrl(
        {
          ...environment,
          DATABASE_BACKUP_URL: undefined,
          DATABASE_URL: originalUrl,
        },
        input
      )
    )
    assert.throws(() =>
      parseSourceConnection(`${originalUrl}?sslmode=verify-full`, 55000)
    )
    assert.throws(() =>
      parseSourceConnection(`${originalUrl}?sslmode=disable`, 55000)
    )
    assert.equal(
      selectSourceUrl(
        {
          ...environment,
          DATABASE_BACKUP_URL: undefined,
          DATABASE_URL: originalUrl,
          RAILWAY_PROJECT_ID: ids.project,
          RAILWAY_ENVIRONMENT_ID: ids.environment,
          RAILWAY_SERVICE_ID: ids.service,
        },
        input
      ),
      originalUrl
    )
  })
})

test("reports only a validated fixed inner snapshot phase", async () => {
  const valid =
    '{"status":"failed","phase":"source_inventory","durationMs":42}\n'
  assert.equal(parseSnapshotFailurePhase(valid), "source_inventory")
  assert.equal(
    parseSnapshotFailurePhase(
      valid + '{"status":"failed","phase":"temporary_cleanup"}\n'
    ),
    "source_inventory"
  )
  assert.equal(
    parseSnapshotFailurePhase(`${valid}raw password=private`),
    undefined
  )
  assert.equal(
    parseSnapshotFailurePhase(
      '{"status":"failed","phase":"password=private","durationMs":42}'
    ),
    undefined
  )
  assert.equal(parseSnapshotFailurePhase("x".repeat(1025)), undefined)
  const failure = stagingFailureRecord(
    "snapshot_capture",
    "source_inventory",
    100
  )
  assert.deepEqual(failure, {
    status: "failed",
    phase: "snapshot_capture",
    innerPhase: "source_inventory",
    durationMs: 100,
  })
  assert.equal(
    stagingFailureRecord("snapshot_capture", "password=private", 100)
      .innerPhase,
    undefined
  )
  const controller = new AbortController()
  await assert.rejects(
    runPrivateCommand(
      process.execPath,
      ["-e", `process.stderr.write(${JSON.stringify(valid)}); process.exit(1)`],
      {
        environment: { PATH: process.env.PATH },
        signal: controller.signal,
        captureSnapshotFailure: true,
      }
    ),
    (error) => {
      assert.equal(error.snapshotFailurePhase, "source_inventory")
      assert.ok(!error.message.includes("private"))
      return true
    }
  )
  await fixture(async ({ output, environment }) => {
    const fake = createFake({ backupFailurePhase: "source_inventory" })
    let innerPhase
    await assert.rejects(
      runStagingSnapshot(args(output), {
        environment,
        command: fake.command,
        tunnelFactory: fake.tunnelFactory,
        portAllocator: async () => 55321,
        onFailurePhase: (value) => {
          innerPhase = value
        },
      })
    )
    assert.equal(innerPhase, "source_inventory")
    assert.deepEqual(await readdir(output), [])
  })
  await fixture(async ({ output, environment }) => {
    const fake = createFake({ backupFailurePhase: "password=private" })
    let innerPhase
    await assert.rejects(
      runStagingSnapshot(args(output), {
        environment,
        command: fake.command,
        tunnelFactory: fake.tunnelFactory,
        portAllocator: async () => 55321,
        onFailurePhase: (value) => {
          innerPhase = value
        },
      })
    )
    assert.equal(innerPhase, undefined)
    assert.deepEqual(await readdir(output), [])
  })
})

test("refuses wrong or ambiguous Railway deployments and remote scope", () => {
  const raw = apiScope()
  const expected = normalizeRailwayScope(raw, flags)
  const line = [
    "RR_SCOPE_V1",
    ids.project,
    ids.environment,
    ids.service,
    ids.deployment,
    ids.replica,
  ].join("|")
  parseRemoteScope(line, expected)
  assert.throws(() =>
    parseRemoteScope(line.replace(ids.replica, ids.volume), expected)
  )
  raw.data.serviceInstance.activeDeployments[0].instances.push({
    id: ids.volume,
    status: "RUNNING",
  })
  assert.throws(() => normalizeRailwayScope(raw, flags))
  const sshArgs = buildSshArguments({
    scope: expected,
    localPort: 55321,
    knownHosts: "/private/known_hosts",
  })
  assert.ok(sshArgs.includes("127.0.0.1:55321:127.0.0.1:5432"))
  assert.ok(sshArgs.includes("StrictHostKeyChecking=yes"))
})

test("SSH scope tunnel rejects unexpected output and early exit", async () => {
  await fixture(async ({ root }) => {
    const bin = join(root, "bin")
    await mkdir(bin, { mode: 0o700 })
    const ssh = join(bin, "ssh")
    const expected = normalizeRailwayScope(apiScope(), flags)
    const line = [
      "RR_SCOPE_V1",
      ids.project,
      ids.environment,
      ids.service,
      ids.deployment,
      ids.replica,
    ].join("|")
    const controller = new AbortController()
    const start = () =>
      startScopeTunnel({
        args: [],
        environment: { PATH: `${bin}:${process.env.PATH}` },
        signal: controller.signal,
        scope: expected,
      })
    await writeFile(ssh, "#!/bin/sh\nexit 0\n", { mode: 0o700 })
    await chmod(ssh, 0o700)
    await assert.rejects(start())
    await writeFile(
      ssh,
      `#!/bin/sh\nprintf '%s\\n' '${line}'\nsleep 0.05\nprintf ' '\nexec sleep 60\n`,
      { mode: 0o700 }
    )
    const tunnel = await start()
    await delay(100)
    assert.throws(() => tunnel.assertOpen())
    await tunnel.close()
  })
})
