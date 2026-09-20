import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import {
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises"
import net from "node:net"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { normalizeScriptArguments } from "./lib/cli-arguments.mjs"
import {
  createPostgresClientEnvironment,
  hashFileSha256,
} from "./lib/postgres-logical-backup.mjs"
import {
  openPrivateOutputDirectory,
  publishSnapshotDirectory,
} from "./lib/postgres-snapshot.mjs"
import {
  readBackupManifest,
  readRestoreReceipt,
} from "./lib/postgres-restore.mjs"
import {
  createRecoveryScope,
  parseRecoveryArguments,
  recoveryTimeoutMs,
} from "./lib/recovery-process.mjs"

const idPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u
const shaPattern = /^[a-f0-9]{64}$/u
const snapshotFailurePhases = new Set([
  "arguments",
  "output_directory",
  "client_version",
  "snapshot_export",
  "source_inventory",
  "dump",
  "archive_verification",
  "snapshot_release",
  "publish",
  "temporary_cleanup",
  "output_directory_cleanup",
])
const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const sourceScopeQuery = `query SourceScope($environmentId: String!, $serviceId: String!, $volumeInstanceId: String!) {
  serviceInstance(environmentId: $environmentId, serviceId: $serviceId) {
    id environmentId serviceId
    activeDeployments {
      id projectId environmentId serviceId status
      instances { id status }
    }
  }
  volumeInstance(id: $volumeInstanceId) {
    id environmentId serviceId volumeId mountPath state
    deletedAt isPendingDeletion
    environment { id projectId }
  }
}`

const help = `Usage: postgres-staging-snapshot --project-id <uuid> --environment-id <uuid>
  --service-id <uuid> --deployment-id <uuid> --deployment-instance-id <uuid>
  --volume-instance-id <uuid> --volume-id <uuid> --output-dir <absolute-private-dir>
Requires DATABASE_URL from a matching Railway-run context, or a separate
process-only DATABASE_BACKUP_URL for the original Railway public proxy URL.
Uses a strict, existing Railway SSH host key and a single exact running instance.
Captures one snapshot-bound archive/receipt through a loopback-only TLS tunnel.
The source remains read-only; pause schema DDL during capture.
DATABASE_RECOVERY_TIMEOUT_MS bounds the full operation (default 30 minutes).
`

const flags = [
  "--project-id",
  "--environment-id",
  "--service-id",
  "--deployment-id",
  "--deployment-instance-id",
  "--volume-instance-id",
  "--volume-id",
  "--output-dir",
]

export const parseStagingArguments = (argv) => {
  const args = parseRecoveryArguments(normalizeScriptArguments(argv), flags)
  for (const flag of flags.slice(0, -1)) assert.match(args[flag], idPattern)
  assert.equal(resolve(args["--output-dir"]), args["--output-dir"])
  return args
}

export const parseSourceConnection = (raw, localPort) => {
  let source
  try {
    source = new URL(raw)
  } catch {
    throw new Error("Invalid source connection.")
  }
  assert.ok(["postgres:", "postgresql:"].includes(source.protocol))
  assert.match(source.hostname.toLowerCase(), /\.proxy\.rlwy\.net$/u)
  assert.ok(source.port && source.username && source.password)
  assert.ok(source.pathname.length > 1 && !source.hash)
  assert.deepEqual(
    [...source.searchParams.keys()],
    [...new Set(source.searchParams.keys())]
  )
  for (const key of source.searchParams.keys()) assert.equal(key, "sslmode")
  const originalMode = source.searchParams.get("sslmode")
  // The existing snapshot CLI has no PGHOSTADDR override for verify-full.
  assert.ok(originalMode === null || originalMode === "require")
  let database
  try {
    database = decodeURIComponent(source.pathname.slice(1))
  } catch {
    throw new Error("Invalid source database encoding.")
  }
  assert.ok(database && !/[\u0000-\u001f\u007f/=]/u.test(database))
  assert.ok(
    Number.isSafeInteger(localPort) && localPort >= 1024 && localPort <= 65535
  )
  const originalFingerprint = createHash("sha256")
    .update(`${source.hostname.toLowerCase()}:${source.port}/${database}`)
    .digest("hex")
  const mapped = new URL(source)
  mapped.hostname = "127.0.0.1"
  mapped.port = String(localPort)
  mapped.searchParams.set("sslmode", "require")
  const mappedUrl = mapped.toString()
  const mappedConnection = createPostgresClientEnvironment(
    mappedUrl,
    "DATABASE_BACKUP_URL"
  )
  assert.equal(mappedConnection.environment.PGSSLMODE, "require")
  return {
    mappedUrl,
    originalFingerprint,
    mappedFingerprint: mappedConnection.fingerprint,
  }
}

export const selectSourceUrl = (environment, args) => {
  const hasBackup = Boolean(environment.DATABASE_BACKUP_URL)
  const hasRailway = Boolean(environment.DATABASE_URL)
  assert.notEqual(hasBackup, hasRailway)
  if (hasRailway) {
    assert.equal(environment.RAILWAY_PROJECT_ID, args["--project-id"])
    assert.equal(environment.RAILWAY_ENVIRONMENT_ID, args["--environment-id"])
    assert.equal(environment.RAILWAY_SERVICE_ID, args["--service-id"])
  }
  return hasBackup ? environment.DATABASE_BACKUP_URL : environment.DATABASE_URL
}

export const normalizeRailwayScope = (raw, args) => {
  const data = raw?.data
  assert.ok(data && !raw.errors)
  const instance = data.serviceInstance
  assert.equal(instance?.environmentId, args["--environment-id"])
  assert.equal(instance?.serviceId, args["--service-id"])
  assert.match(instance?.id, idPattern)
  assert.ok(Array.isArray(instance.activeDeployments))
  assert.equal(instance.activeDeployments.length, 1)
  const deployment = instance.activeDeployments[0]
  assert.equal(deployment?.id, args["--deployment-id"])
  assert.equal(deployment?.projectId, args["--project-id"])
  assert.equal(deployment?.environmentId, args["--environment-id"])
  assert.equal(deployment?.serviceId, args["--service-id"])
  assert.equal(deployment?.status, "SUCCESS")
  assert.ok(Array.isArray(deployment.instances))
  assert.equal(deployment.instances.length, 1)
  assert.equal(deployment.instances[0]?.id, args["--deployment-instance-id"])
  assert.equal(deployment.instances[0]?.status, "RUNNING")
  const volume = data.volumeInstance
  assert.equal(volume?.id, args["--volume-instance-id"])
  assert.equal(volume?.volumeId, args["--volume-id"])
  assert.equal(volume?.environmentId, args["--environment-id"])
  assert.equal(volume?.serviceId, args["--service-id"])
  assert.equal(volume?.environment?.id, args["--environment-id"])
  assert.equal(volume?.environment?.projectId, args["--project-id"])
  assert.equal(volume?.state, "READY")
  assert.equal(volume?.deletedAt, null)
  assert.equal(volume?.isPendingDeletion, false)
  assert.match(volume?.mountPath, /^\/[a-zA-Z0-9/_-]+$/u)
  return {
    projectId: args["--project-id"],
    environmentId: args["--environment-id"],
    serviceId: args["--service-id"],
    serviceInstanceId: instance.id,
    deploymentId: deployment.id,
    deploymentInstanceId: deployment.instances[0].id,
    volumeInstanceId: volume.id,
    volumeId: volume.volumeId,
    volumeMountPath: volume.mountPath,
  }
}

export const parseRemoteScope = (line, expected) => {
  const parts = line.split("|")
  assert.deepEqual(parts.slice(0, 1), ["RR_SCOPE_V1"])
  assert.equal(parts.length, 6)
  for (const value of parts.slice(1)) assert.match(value, idPattern)
  assert.deepEqual(parts.slice(1), [
    expected.projectId,
    expected.environmentId,
    expected.serviceId,
    expected.deploymentId,
    expected.deploymentInstanceId,
  ])
}

export const buildSshArguments = ({ scope, localPort, knownHosts }) => [
  "-F",
  "/dev/null",
  "-T",
  "-o",
  "BatchMode=yes",
  "-o",
  "StrictHostKeyChecking=yes",
  "-o",
  `UserKnownHostsFile=${knownHosts}`,
  "-o",
  "ExitOnForwardFailure=yes",
  "-o",
  "ForwardAgent=no",
  "-o",
  "ConnectTimeout=10",
  "-o",
  "ServerAliveInterval=10",
  "-o",
  "ServerAliveCountMax=3",
  "-L",
  `127.0.0.1:${localPort}:127.0.0.1:5432`,
  `${scope.serviceInstanceId}@ssh.railway.com`,
  'printf \'RR_SCOPE_V1|%s|%s|%s|%s|%s\\n\' "$RAILWAY_PROJECT_ID" "$RAILWAY_ENVIRONMENT_ID" "$RAILWAY_SERVICE_ID" "$RAILWAY_DEPLOYMENT_ID" "$RAILWAY_REPLICA_ID"; exec sleep 14400',
]

export const parseSnapshotFailurePhase = (raw) => {
  if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > 1024)
    return undefined
  const lines = raw.trimEnd().split("\n")
  if (lines.length < 1 || lines.length > 2) return undefined
  try {
    const primary = JSON.parse(lines[0])
    if (
      !primary ||
      Object.keys(primary).sort().join(",") !== "durationMs,phase,status" ||
      primary.status !== "failed" ||
      !snapshotFailurePhases.has(primary.phase) ||
      !Number.isSafeInteger(primary.durationMs) ||
      primary.durationMs < 0 ||
      primary.durationMs > 4 * 60 * 60 * 1000
    )
      return undefined
    if (lines.length === 2) {
      const cleanup = JSON.parse(lines[1])
      if (
        !cleanup ||
        Object.keys(cleanup).sort().join(",") !== "phase,status" ||
        cleanup.status !== "failed" ||
        !["temporary_cleanup", "output_directory_cleanup"].includes(
          cleanup.phase
        )
      )
        return undefined
    }
    return primary.phase
  } catch {
    return undefined
  }
}

export const runPrivateCommand = (
  command,
  args,
  {
    environment,
    signal,
    timeoutMs = 15_000,
    maxOutputBytes = 64 * 1024,
    graceful = false,
    captureSnapshotFailure = false,
  }
) =>
  new Promise((resolveResult, reject) => {
    if (signal.aborted) return reject(new Error("Private command cancelled."))
    const deadline = AbortSignal.timeout(timeoutMs)
    const combined = AbortSignal.any([signal, deadline])
    let child
    try {
      child = spawn(command, args, {
        env: environment,
        stdio: ["ignore", "pipe", captureSnapshotFailure ? "pipe" : "ignore"],
        signal: combined,
        killSignal: graceful ? "SIGTERM" : "SIGKILL",
      })
    } catch {
      reject(new Error("Private command could not start."))
      return
    }
    let failed = false
    let bytes = 0
    const chunks = []
    const errorChunks = []
    let errorBytes = 0
    let errorOverflow = false
    let escalation
    combined.addEventListener(
      "abort",
      () => {
        if (graceful)
          escalation = setTimeout(() => child.kill("SIGKILL"), 5_000)
      },
      { once: true }
    )
    child.on("error", () => {
      failed = true
    })
    child.stdout.on("error", () => {
      failed = true
      child.kill("SIGKILL")
    })
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length
      if (bytes > maxOutputBytes) {
        failed = true
        child.kill("SIGKILL")
      } else if (!failed) chunks.push(chunk)
    })
    if (captureSnapshotFailure) {
      child.stderr.on("error", () => {
        errorOverflow = true
      })
      child.stderr.on("data", (chunk) => {
        errorBytes += chunk.length
        if (errorBytes > 1024) errorOverflow = true
        else if (!errorOverflow) errorChunks.push(chunk)
      })
    }
    child.once("close", (code, terminationSignal) => {
      if (escalation) clearTimeout(escalation)
      if (failed || combined.aborted || terminationSignal || code !== 0) {
        const error = new Error("Private command failed or exceeded its limit.")
        if (
          captureSnapshotFailure &&
          !failed &&
          !combined.aborted &&
          !terminationSignal &&
          !errorOverflow
        ) {
          error.snapshotFailurePhase = parseSnapshotFailurePhase(
            Buffer.concat(errorChunks).toString("utf8")
          )
        }
        reject(error)
      } else resolveResult(Buffer.concat(chunks).toString("utf8").trim())
    })
  })

export const allocateLoopbackPort = async () =>
  new Promise((resolvePort, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port
      server.close((error) => (error ? reject(error) : resolvePort(port)))
    })
  })

export const startScopeTunnel = async ({
  args,
  environment,
  signal,
  scope,
}) => {
  signal.throwIfAborted()
  const child = spawn("ssh", args, {
    env: environment,
    stdio: ["ignore", "pipe", "ignore"],
    signal,
    killSignal: "SIGKILL",
  })
  let closed = false
  let faulted = false
  let settled = false
  let output = ""
  let resolveReady
  let rejectReady
  const readiness = new Promise((resolveValue, reject) => {
    resolveReady = resolveValue
    rejectReady = reject
  })
  void readiness.catch(() => {})
  const exited = new AbortController()
  const closedPromise = new Promise((resolveClosed) => {
    child.once("close", () => {
      closed = true
      exited.abort()
      if (!settled) {
        settled = true
        rejectReady(
          new Error("SSH tunnel closed before identity verification.")
        )
      }
      resolveClosed()
    })
  })
  const fail = () => {
    faulted = true
    if (!settled) {
      settled = true
      rejectReady(new Error("SSH tunnel identity verification failed."))
    }
    child.kill("SIGKILL")
  }
  const timer = setTimeout(fail, 15_000)
  child.on("error", fail)
  child.stdout.on("error", fail)
  child.stdout.on("data", (chunk) => {
    if (settled) {
      if (chunk.length) fail()
      return
    }
    output += chunk.toString("utf8")
    if (output.length > 512) return fail()
    const newline = output.indexOf("\n")
    if (newline === -1) return
    try {
      parseRemoteScope(output.slice(0, newline), scope)
      if (output.slice(newline + 1).length) return fail()
      settled = true
      resolveReady()
    } catch {
      fail()
    }
  })
  try {
    await readiness
    clearTimeout(timer)
    assert.ok(!closed && !faulted && !signal.aborted)
    return {
      exitSignal: exited.signal,
      assertOpen: () => assert.ok(!closed && !faulted && !signal.aborted),
      close: async () => {
        if (!closed) child.kill("SIGKILL")
        await closedPromise
      },
    }
  } catch {
    clearTimeout(timer)
    if (!closed) child.kill("SIGKILL")
    await closedPromise
    throw new Error("SSH tunnel identity verification failed.")
  }
}

const sshEnvironment = (environment) => ({
  HOME: environment.HOME,
  PATH: environment.PATH,
  ...(environment.SSH_AUTH_SOCK
    ? { SSH_AUTH_SOCK: environment.SSH_AUTH_SOCK }
    : {}),
})

const providerEnvironment = (environment) => ({
  ...sshEnvironment(environment),
  ...(environment.RAILWAY_TOKEN
    ? { RAILWAY_TOKEN: environment.RAILWAY_TOKEN }
    : {}),
  ...(environment.RAILWAY_API_TOKEN
    ? { RAILWAY_API_TOKEN: environment.RAILWAY_API_TOKEN }
    : {}),
})

const readPublishedBundle = async (
  output,
  stagingParent,
  mappedFingerprint,
  signal
) => {
  const value = JSON.parse(output)
  assert.equal(value.status, "snapshot_bundle_verified")
  assert.match(value.sha256, shaPattern)
  assert.equal(dirname(value.archivePath), dirname(value.manifestPath))
  assert.equal(dirname(value.archivePath), dirname(value.receiptPath))
  const bundle = dirname(value.archivePath)
  assert.equal(dirname(bundle), stagingParent)
  assert.match(basename(bundle), /^postgres-snapshot-[A-Za-z0-9-]+$/u)
  assert.equal(basename(value.archivePath), "database.dump")
  assert.equal(basename(value.manifestPath), "database.manifest.json")
  assert.equal(basename(value.receiptPath), "database.restore-receipt.json")
  assert.equal(await realpath(bundle), bundle)
  const archiveMetadata = await lstat(value.archivePath)
  assert.ok(archiveMetadata.isFile() && !archiveMetadata.isSymbolicLink())
  assert.equal(archiveMetadata.mode & 0o077, 0)
  for (const path of [value.manifestPath, value.receiptPath]) {
    const metadata = await lstat(path)
    assert.ok(metadata.isFile() && !metadata.isSymbolicLink())
    assert.equal(metadata.mode & 0o077, 0)
  }
  const [manifest, receipt, actualHash] = await Promise.all([
    readBackupManifest(value.manifestPath, signal),
    readRestoreReceipt(value.receiptPath, signal),
    hashFileSha256(value.archivePath, { signal }),
  ])
  assert.equal(manifest.sha256, actualHash)
  assert.equal(value.sha256, actualHash)
  assert.equal(manifest.bytes, archiveMetadata.size)
  assert.equal(manifest.sourceFingerprint, mappedFingerprint)
  assert.equal(receipt.archiveSha256, actualHash)
  assert.equal(receipt.sourceFingerprint, mappedFingerprint)
  assert.equal(value.sourceMajor, receipt.invariants.serverMajor)
  return {
    bundle,
    archive: value.archivePath,
    manifestPath: value.manifestPath,
    receiptPath: value.receiptPath,
    manifest,
    receipt,
    actualHash,
  }
}

const sourceSystemIdQuery =
  "SELECT system_identifier::text FROM pg_catalog.pg_control_system()"

const readSourceSystemId = async (command, connection, signal, path) => {
  const environment = {
    ...createPostgresClientEnvironment(
      connection.mappedUrl,
      "DATABASE_BACKUP_URL"
    ).environment,
    LANG: "C",
    PATH: path,
  }
  const raw = await command(
    "psql",
    [
      "--no-psqlrc",
      "--no-password",
      "--quiet",
      "--set=ON_ERROR_STOP=1",
      "--tuples-only",
      "--no-align",
      `--command=${sourceSystemIdQuery}`,
    ],
    { environment, signal, timeoutMs: 15_000, maxOutputBytes: 128 }
  )
  assert.match(raw, /^[1-9]\d{0,19}$/u)
  assert.ok(BigInt(raw) <= 18446744073709551615n)
  return raw
}

export const runStagingSnapshot = async (
  argv,
  {
    environment = process.env,
    command = runPrivateCommand,
    tunnelFactory = startScopeTunnel,
    portAllocator = allocateLoopbackPort,
    onPhase = () => {},
    onFailurePhase = () => {},
  } = {}
) => {
  const args = parseStagingArguments(argv)
  assert.ok(environment.HOME && resolve(environment.HOME) === environment.HOME)
  assert.ok(environment.PATH)
  const scopeController = createRecoveryScope(
    recoveryTimeoutMs(environment.DATABASE_RECOVERY_TIMEOUT_MS)
  )
  const signal = scopeController.signal
  let outputDirectory
  let stagingParent
  let publishedBundle
  let tunnel
  let failure
  let evidence
  try {
    onPhase("source_url")
    const rawSourceUrl = selectSourceUrl(environment, args)
    const original = parseSourceConnection(rawSourceUrl, 5432)
    const knownHosts = join(environment.HOME, ".ssh", "known_hosts")
    const knownHostsMetadata = await lstat(knownHosts)
    assert.ok(
      knownHostsMetadata.isFile() && !knownHostsMetadata.isSymbolicLink()
    )
    assert.equal(await realpath(knownHosts), knownHosts)
    assert.equal(knownHostsMetadata.mode & 0o022, 0)
    const sshClientEnvironment = sshEnvironment(environment)
    const apiEnvironment = providerEnvironment(environment)
    onPhase("host_key")
    await command("ssh-keygen", ["-F", "ssh.railway.com", "-f", knownHosts], {
      environment: sshClientEnvironment,
      signal,
      timeoutMs: 5_000,
    })
    const readScope = async () => {
      const raw = await command(
        "railway",
        [
          "api",
          sourceScopeQuery,
          "--variables",
          JSON.stringify({
            environmentId: args["--environment-id"],
            serviceId: args["--service-id"],
            volumeInstanceId: args["--volume-instance-id"],
          }),
          "--compact",
        ],
        {
          environment: apiEnvironment,
          signal,
          timeoutMs: 15_000,
        }
      )
      return normalizeRailwayScope(JSON.parse(raw), args)
    }
    onPhase("source_preflight")
    const preflight = await readScope()
    const localPort = await portAllocator()
    const connection = parseSourceConnection(rawSourceUrl, localPort)
    onPhase("tunnel")
    tunnel = await tunnelFactory({
      args: buildSshArguments({ scope: preflight, localPort, knownHosts }),
      environment: sshClientEnvironment,
      signal,
      scope: preflight,
    })
    tunnel.assertOpen()
    onPhase("source_system_id")
    const sourceSystemId = await readSourceSystemId(
      command,
      connection,
      AbortSignal.any([signal, tunnel.exitSignal]),
      environment.PATH
    )
    tunnel.assertOpen()
    onPhase("output_directory")
    await mkdir(args["--output-dir"], { mode: 0o700, recursive: true })
    outputDirectory = await openPrivateOutputDirectory(args["--output-dir"])
    stagingParent = await mkdtemp(
      join(args["--output-dir"], ".staging-source-")
    )
    onPhase("snapshot_capture")
    const backupSignal = AbortSignal.any([signal, tunnel.exitSignal])
    const backupOutput = await command(
      process.execPath,
      [
        join(scriptDirectory, "postgres-snapshot-backup.mjs"),
        "--output-dir",
        stagingParent,
      ],
      {
        environment: {
          HOME: environment.HOME,
          PATH: environment.PATH,
          DATABASE_BACKUP_URL: connection.mappedUrl,
          ...(environment.DATABASE_RECOVERY_TIMEOUT_MS
            ? {
                DATABASE_RECOVERY_TIMEOUT_MS:
                  environment.DATABASE_RECOVERY_TIMEOUT_MS,
              }
            : {}),
        },
        signal: backupSignal,
        timeoutMs: recoveryTimeoutMs(environment.DATABASE_RECOVERY_TIMEOUT_MS),
        maxOutputBytes: 4096,
        graceful: true,
        captureSnapshotFailure: true,
      }
    )
    tunnel.assertOpen()
    const bundle = await readPublishedBundle(
      backupOutput,
      stagingParent,
      connection.mappedFingerprint,
      signal
    )
    onPhase("source_postflight")
    const postflight = await readScope()
    assert.deepEqual(postflight, preflight)
    tunnel.assertOpen()
    assert.equal(
      await readSourceSystemId(
        command,
        connection,
        AbortSignal.any([signal, tunnel.exitSignal]),
        environment.PATH
      ),
      sourceSystemId
    )
    tunnel.assertOpen()
    const scopeReceipt = {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      source: preflight,
      sourceSystemId,
      originalEndpointFingerprint: original.originalFingerprint,
      mappedEndpointFingerprint: connection.mappedFingerprint,
      archiveSha256: bundle.actualHash,
      manifestSha256: await hashFileSha256(bundle.manifestPath, { signal }),
      restoreReceiptSha256: await hashFileSha256(bundle.receiptPath, {
        signal,
      }),
      sourceMajor: bundle.receipt.invariants.serverMajor,
      tunnelHost: "ssh.railway.com",
      tunnelTlsMode: "require",
    }
    onPhase("publish")
    signal.throwIfAborted()
    await writeFile(
      join(bundle.bundle, "source-scope.receipt.json"),
      `${JSON.stringify(scopeReceipt, null, 2)}\n`,
      {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
        signal,
      }
    )
    tunnel.assertOpen()
    const published = join(
      args["--output-dir"],
      `postgres-staging-snapshot-${randomUUID()}`
    )
    await publishSnapshotDirectory({
      pendingDirectory: bundle.bundle,
      publishedDirectory: published,
      signal,
      outputDirectory,
      onRenamed: (path) => {
        publishedBundle = path
      },
    })
    evidence = {
      status: "staging_snapshot_bound",
      archivePath: join(published, "database.dump"),
      manifestPath: join(published, "database.manifest.json"),
      receiptPath: join(published, "database.restore-receipt.json"),
      sourceScopePath: join(published, "source-scope.receipt.json"),
      archiveSha256: bundle.actualHash,
      sourceMajor: bundle.receipt.invariants.serverMajor,
    }
  } catch (error) {
    failure = error
  } finally {
    const cleanup = []
    if (tunnel)
      try {
        await tunnel.close()
      } catch {
        cleanup.push("tunnel")
      }
    if (stagingParent)
      try {
        await rm(stagingParent, { recursive: true })
      } catch {
        cleanup.push("staging")
      }
    if (outputDirectory)
      try {
        await outputDirectory.close()
      } catch {
        cleanup.push("output")
      }
    scopeController.close()
    if (cleanup.length) failure = new Error("Staging snapshot cleanup failed.")
    if (failure && publishedBundle)
      try {
        await rm(publishedBundle, { recursive: true })
      } catch {
        failure = new Error("Staging snapshot artifact cleanup failed.")
      }
  }
  if (failure) {
    if (snapshotFailurePhases.has(failure.snapshotFailurePhase))
      onFailurePhase(failure.snapshotFailurePhase)
    throw failure
  }
  return evidence
}

export const stagingFailureRecord = (phase, innerPhase, durationMs) => ({
  status: "failed",
  phase,
  ...(snapshotFailurePhases.has(innerPhase) ? { innerPhase } : {}),
  durationMs,
})

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  let phase = "arguments"
  let innerPhase
  const startedAt = Date.now()
  try {
    const args = normalizeScriptArguments(process.argv.slice(2))
    if (args.length === 1 && args[0] === "--help") process.stdout.write(help)
    else {
      const result = await runStagingSnapshot(process.argv.slice(2), {
        onPhase: (value) => {
          phase = value
        },
        onFailurePhase: (value) => {
          innerPhase = value
        },
      })
      process.stdout.write(
        `${JSON.stringify({ ...result, durationMs: Date.now() - startedAt })}\n`
      )
    }
  } catch {
    process.stderr.write(
      `${JSON.stringify(stagingFailureRecord(phase, innerPhase, Date.now() - startedAt))}\n`
    )
    process.exitCode = 1
  }
}
