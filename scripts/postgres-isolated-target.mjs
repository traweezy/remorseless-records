import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import { constants } from "node:fs"
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from "node:fs/promises"
import { createConnection, createServer } from "node:net"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { normalizeScriptArguments } from "./lib/cli-arguments.mjs"
import {
  businessParitySchemaSql,
  businessParitySql,
  parseBusinessParityOutput,
  parseBusinessParitySchema,
} from "./lib/postgres-business-parity.mjs"
import {
  parsePostgresStripeDescriptor,
  postgresStripeDescriptorSql,
} from "./lib/postgres-stripe-parity.mjs"
import {
  parseStripeBusinessParityReport,
  runStripeBusinessParity,
} from "./lib/stripe-business-parity-runner.mjs"
import {
  createPostgresClientEnvironment,
  hashFileSha256,
} from "./lib/postgres-logical-backup.mjs"
import {
  parseRestoreInventory,
  parseRestoreInvariants,
  parseRestoreTableList,
  buildRestoreInvariantsSql,
  openRegularFile,
  readBackupManifest,
  readRestoreReceipt,
  RESTORE_TABLE_LIST_SQL,
  RESTORE_TARGET_PREFLIGHT_SQL,
} from "./lib/postgres-restore.mjs"
import { openPrivateOutputDirectory } from "./lib/postgres-snapshot.mjs"

const imageId =
  "sha256:76db58e52e571729aa4ab51a5c597189e6f570086345c29b68b358067a6547e8"
const imageUser = "999:999"
const maxArchiveBytes = 512 * 1024 * 1024
const ownerLabel = "com.remorseless.recovery.target"
const dataPath = "/var/lib/postgresql/data"
const socketPath = "/run/postgresql"
const psqlPath = "/usr/lib/postgresql/16/bin/psql"
const restorePath = fileURLToPath(
  new URL("./postgres-restore-drill.mjs", import.meta.url)
)
const states = new Set([
  "provisioning",
  "ready",
  "restore_attempted",
  "restored",
])
const createSubphases = new Set([
  "base_directory",
  "source_bundle",
  "docker_daemon",
  "image_identity",
  "client_toolchain",
  "disk_capacity",
  "port_selection",
  "target_directory",
  "local_access",
  "state_persist",
  "volume_create",
  "cluster_init",
  "server_start",
  "target_verify",
  "cleanup",
])
class CreateFailure extends Error {
  constructor(subphase) {
    super("Isolated target creation failed.")
    this.subphase = subphase
  }
}
export const createPhaseFailure = (subphase) => {
  assert.ok(createSubphases.has(subphase))
  return new CreateFailure(subphase)
}
export const runCreatePhase = async (subphase, operation) => {
  try {
    return await operation()
  } catch {
    throw createPhaseFailure(subphase)
  }
}
export const isolatedTargetFailureEvent = (error) => ({
  status: "failed",
  phase: "isolated_target",
  ...(error instanceof CreateFailure && createSubphases.has(error.subphase)
    ? { subphase: error.subphase }
    : {}),
})
export const finishFailedCreate = async (failure, cleanup) => {
  try {
    await cleanup()
  } catch {
    throw createPhaseFailure("cleanup")
  }
  throw failure
}
const sourceIdPattern = /^[1-9]\d{9,19}$/u
const ownerPattern = /^[a-f0-9]{32}$/u
const containerIdPattern = /^[a-f0-9]{64}$/u
const sha256Pattern = /^[a-f0-9]{64}$/u
const uuidPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u
const help = `Usage: postgres-isolated-target <create|verify|preflight|apply|business-parity|stripe-parity|cleanup> [options]
create --base-dir <absolute-private-dir> --source-scope <path> --archive <path> --manifest <path> --receipt <path>
verify --target-dir <created-dir>
preflight --target-dir <created-dir>
apply --target-dir <created-dir> --confirm <fingerprint>
business-parity --target-dir <restored-dir>
stripe-parity --target-dir <restored-dir> --output <private-new-file>
cleanup --target-dir <created-dir>
Uses only the pinned local Docker default-context image, a private Unix socket,
and an in-process loopback relay. Only stripe-parity makes bounded, read-only
Stripe test-mode requests from the host, with a pinned expected account ID.
Apply is single-use: a failed or interrupted attempt requires inspection and cleanup.
`

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")

export const readPrivateBoundedFile = async (path, limit, signal) => {
  assert.ok(Number.isSafeInteger(limit) && limit > 0 && limit <= 256 * 1024)
  const file = await openRegularFile(path)
  try {
    const before = await file.stat({ bigint: true })
    assert.ok(before.size > 0n && before.size <= BigInt(limit))
    const bytes = Buffer.alloc(Number(before.size) + 1)
    let offset = 0
    while (offset < bytes.length) {
      signal?.throwIfAborted()
      const { bytesRead } = await file.read(
        bytes,
        offset,
        bytes.length - offset
      )
      if (bytesRead === 0) break
      offset += bytesRead
    }
    const after = await file.stat({ bigint: true })
    assert.equal(offset, Number(before.size))
    assert.ok(
      before.dev === after.dev &&
        before.ino === after.ino &&
        before.size === after.size &&
        before.mtimeNs === after.mtimeNs &&
        before.ctimeNs === after.ctimeNs
    )
    signal?.throwIfAborted()
    return bytes.subarray(0, offset)
  } finally {
    await file.close()
  }
}

export const verifySourceScope = async (paths) => {
  const values = Object.values(paths)
  assert.equal(values.length, 4)
  for (const path of values) {
    assert.equal(resolve(path), path)
    assert.equal(await realpath(path), path)
    assert.equal(dirname(path), dirname(paths.sourceScopePath))
    const metadata = await lstat(path)
    assert.ok(metadata.isFile() && !metadata.isSymbolicLink())
    assert.equal(metadata.uid, process.getuid())
    assert.equal(metadata.mode & 0o077, 0)
  }
  await canonicalPrivateDirectory(dirname(paths.sourceScopePath))
  const scopeBytes = await readPrivateBoundedFile(paths.sourceScopePath, 16_384)
  const archive = await openRegularFile(paths.archivePath)
  let archiveSize
  try {
    const archiveMetadata = await archive.stat()
    assert.ok(
      archiveMetadata.size > 0 && archiveMetadata.size <= maxArchiveBytes
    )
    archiveSize = archiveMetadata.size
  } finally {
    await archive.close()
  }
  const scope = JSON.parse(scopeBytes.toString("utf8"))
  assert.deepEqual(Object.keys(scope).sort(), [
    "archiveSha256",
    "capturedAt",
    "manifestSha256",
    "mappedEndpointFingerprint",
    "originalEndpointFingerprint",
    "restoreReceiptSha256",
    "schemaVersion",
    "source",
    "sourceMajor",
    "sourceSystemId",
    "tunnelHost",
    "tunnelTlsMode",
  ])
  assert.equal(scope.schemaVersion, 1)
  assert.equal(scope.sourceMajor, 16)
  assert.match(scope.sourceSystemId, sourceIdPattern)
  for (const key of [
    "archiveSha256",
    "manifestSha256",
    "restoreReceiptSha256",
    "originalEndpointFingerprint",
    "mappedEndpointFingerprint",
  ])
    assert.match(scope[key], sha256Pattern)
  assert.notEqual(
    scope.originalEndpointFingerprint,
    scope.mappedEndpointFingerprint
  )
  assert.deepEqual(Object.keys(scope.source).sort(), [
    "deploymentId",
    "deploymentInstanceId",
    "environmentId",
    "projectId",
    "serviceId",
    "serviceInstanceId",
    "volumeId",
    "volumeInstanceId",
    "volumeMountPath",
  ])
  for (const [key, value] of Object.entries(scope.source)) {
    if (key === "volumeMountPath") {
      assert.ok(typeof value === "string" && value.startsWith("/"))
      assert.equal(resolve(value), value)
    } else assert.match(value, uuidPattern)
  }
  assert.equal(scope.tunnelHost, "ssh.railway.com")
  assert.equal(scope.tunnelTlsMode, "require")
  assert.equal(new Date(scope.capturedAt).toISOString(), scope.capturedAt)
  const signal = AbortSignal.timeout(30_000)
  const manifest = await readBackupManifest(paths.manifestPath, signal)
  const receipt = await readRestoreReceipt(paths.receiptPath, signal)
  assert.equal(archiveSize, manifest.bytes)
  assert.equal(manifest.sha256, scope.archiveSha256)
  assert.equal(receipt.archiveSha256, scope.archiveSha256)
  assert.equal(manifest.sourceFingerprint, scope.mappedEndpointFingerprint)
  assert.equal(receipt.sourceFingerprint, scope.mappedEndpointFingerprint)
  assert.equal(receipt.invariants.serverMajor, scope.sourceMajor)
  assert.equal(
    await hashFileSha256(paths.archivePath, { signal }),
    scope.archiveSha256
  )
  assert.equal(sha256(await readFile(paths.manifestPath)), scope.manifestSha256)
  assert.equal(
    sha256(await readFile(paths.receiptPath)),
    scope.restoreReceiptSha256
  )
  return {
    scope,
    receipt,
    hashes: {
      sourceScopeSha256: sha256(scopeBytes),
      archiveSha256: scope.archiveSha256,
      manifestSha256: scope.manifestSha256,
      receiptSha256: scope.restoreReceiptSha256,
    },
  }
}

const assertSourceScope = async (state) => {
  const { scope, receipt, hashes } = await verifySourceScope({
    sourceScopePath: state.sourceScopePath,
    archivePath: state.archivePath,
    manifestPath: state.manifestPath,
    receiptPath: state.receiptPath,
  })
  assert.equal(scope.sourceSystemId, state.sourceSystemId)
  for (const [key, hash] of Object.entries(hashes))
    assert.equal(state[key], hash)
  return receipt
}

const copyPinnedFile = async (
  source,
  destination,
  expectedHash,
  maxBytes,
  signal
) => {
  const input = await open(
    source,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  )
  let output
  try {
    const before = await input.stat()
    assert.ok(before.isFile() && before.uid === process.getuid())
    assert.ok(before.size > 0 && before.size <= maxBytes)
    output = await open(destination, "wx", 0o600)
    const digest = createHash("sha256")
    const buffer = Buffer.allocUnsafe(64 * 1024)
    let position = 0
    while (true) {
      signal?.throwIfAborted()
      const { bytesRead } = await input.read(buffer, 0, buffer.length, position)
      if (bytesRead === 0) break
      assert.ok(position + bytesRead <= maxBytes)
      let written = 0
      while (written < bytesRead) {
        const result = await output.write(
          buffer,
          written,
          bytesRead - written,
          position + written
        )
        assert.ok(result.bytesWritten > 0)
        written += result.bytesWritten
      }
      digest.update(buffer.subarray(0, bytesRead))
      position += bytesRead
    }
    await output.sync()
    const after = await input.stat()
    assert.equal(after.dev, before.dev)
    assert.equal(after.ino, before.ino)
    assert.equal(after.size, before.size)
    assert.equal(position, before.size)
    assert.equal(digest.digest("hex"), expectedHash)
  } finally {
    if (output) await output.close()
    await input.close()
  }
}

const snapshotSource = async (state, signal) => {
  const directory = await mkdtemp(join(state.root, ".restore-input-"))
  const paths = {
    sourceScopePath: join(directory, "source-scope.receipt.json"),
    archivePath: join(directory, "database.dump"),
    manifestPath: join(directory, "database.manifest.json"),
    receiptPath: join(directory, "database.restore-receipt.json"),
  }
  try {
    for (const [sourceKey, hashKey, maxBytes] of [
      ["sourceScopePath", "sourceScopeSha256", 16_384],
      ["archivePath", "archiveSha256", maxArchiveBytes],
      ["manifestPath", "manifestSha256", 65_536],
      ["receiptPath", "receiptSha256", 262_144],
    ])
      await copyPinnedFile(
        state[sourceKey],
        paths[sourceKey],
        state[hashKey],
        maxBytes,
        signal
      )
    return { directory, paths }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

const safeEnvironment = () => ({
  PATH: "/usr/lib/postgresql/16/bin:/usr/bin:/bin",
  LANG: "C",
  ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
})

export const runBounded = async (
  command,
  args,
  {
    timeoutMs = 15_000,
    maxBytes = 65_536,
    environment = safeEnvironment(),
    signal,
    killSignal = "SIGKILL",
    terminationGraceMs = 5000,
  } = {}
) =>
  new Promise((resolveResult, reject) => {
    const commandSignal = signal
      ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal])
      : AbortSignal.timeout(timeoutMs)
    const child = spawn(command, args, {
      env: environment,
      stdio: ["ignore", "pipe", "ignore"],
      signal: commandSignal,
      killSignal,
    })
    let output = ""
    let failed = false
    let forceTimer
    const scheduleForceKill = () => {
      if (killSignal === "SIGTERM" && !forceTimer)
        forceTimer = setTimeout(() => child.kill("SIGKILL"), terminationGraceMs)
    }
    commandSignal.addEventListener("abort", scheduleForceKill, { once: true })
    if (commandSignal.aborted) scheduleForceKill()
    child.on("error", () => {
      failed = true
    })
    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8")
      if (Buffer.byteLength(output, "utf8") > maxBytes) {
        failed = true
        child.kill(killSignal)
        scheduleForceKill()
      }
    })
    child.once("close", (code, signal) => {
      clearTimeout(forceTimer)
      commandSignal.removeEventListener("abort", scheduleForceKill)
      if (failed || signal || code !== 0) reject(new Error("Command failed."))
      else resolveResult(output.trim())
    })
  })

const docker = (args, options) =>
  runBounded("docker", ["--context", "default", ...args], options)

const localDockerIdentity = async () => {
  const endpoint = await docker([
    "context",
    "inspect",
    "default",
    "--format",
    "{{.Endpoints.docker.Host}}",
  ])
  assert.equal(endpoint, "unix:///var/run/docker.sock")
  assert.ok((await stat("/var/run/docker.sock")).isSocket())
  const daemonId = await docker(["info", "--format", "{{.ID}}"])
  assert.match(daemonId, uuidPattern)
  return daemonId
}

const canonicalPrivateDirectory = async (path) => {
  assert.equal(resolve(path), path)
  const metadata = await lstat(path)
  assert.ok(metadata.isDirectory() && !metadata.isSymbolicLink())
  assert.equal(metadata.uid, process.getuid())
  assert.equal(metadata.mode & 0o077, 0)
  assert.equal(await realpath(path), path)
  const anchor = await openPrivateOutputDirectory(path)
  try {
    await anchor.assertStable()
  } finally {
    await anchor.close()
  }
  return metadata
}

const withTargetLock = async (root, work) => {
  const holder = spawn(
    "/usr/bin/flock",
    [
      "--nonblock",
      "--no-fork",
      root,
      "/bin/sh",
      "-c",
      "echo ready; cat >/dev/null",
    ],
    { env: safeEnvironment(), stdio: ["pipe", "pipe", "ignore"] }
  )
  let closed = false
  const completed = new Promise((resolveComplete) =>
    holder.once("close", (code) => {
      closed = true
      resolveComplete(code)
    })
  )
  const ready = new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => {
      holder.kill("SIGKILL")
      reject(new Error("Target lock timed out."))
    }, 5000)
    holder.stdout.once("data", (chunk) => {
      clearTimeout(timer)
      if (chunk.toString("utf8") === "ready\n") resolveReady()
      else reject(new Error("Target lock handshake failed."))
    })
    holder.once("error", () => {
      clearTimeout(timer)
      reject(new Error("Target lock could not start."))
    })
    holder.once("close", () => {
      clearTimeout(timer)
      reject(new Error("Target is already in use."))
    })
  })
  try {
    await ready
    const result = await work()
    assert.equal(closed, false)
    return result
  } finally {
    holder.stdin.end()
    const deadline = setTimeout(() => holder.kill("SIGKILL"), 5000)
    await completed
    clearTimeout(deadline)
  }
}

const readState = async (root) => {
  await canonicalPrivateDirectory(root)
  await canonicalPrivateDirectory(dirname(root))
  assert.match(basename(root), /^pg16-target-[a-f0-9]{32}$/u)
  const path = join(root, "state.json")
  const state = JSON.parse(
    (await readPrivateBoundedFile(path, 4096)).toString("utf8")
  )
  assert.deepEqual(Object.keys(state).sort(), [
    "archivePath",
    "archiveSha256",
    "containerId",
    "containerName",
    "createdAt",
    "daemonId",
    "imageId",
    "manifestPath",
    "manifestSha256",
    "owner",
    "phase",
    "port",
    "receiptPath",
    "receiptSha256",
    "root",
    "schemaVersion",
    "sourceScopePath",
    "sourceScopeSha256",
    "sourceSystemId",
    "targetSystemId",
    "volumeName",
  ])
  assert.equal(state.schemaVersion, 1)
  assert.equal(state.root, root)
  assert.equal(state.imageId, imageId)
  assert.match(state.daemonId, uuidPattern)
  assert.match(state.owner, ownerPattern)
  assert.equal(basename(root), `pg16-target-${state.owner}`)
  assert.ok(states.has(state.phase))
  assert.match(state.sourceSystemId, sourceIdPattern)
  for (const path of [
    state.sourceScopePath,
    state.archivePath,
    state.manifestPath,
    state.receiptPath,
  ]) {
    assert.equal(resolve(path), path)
    assert.equal(dirname(path), dirname(state.sourceScopePath))
  }
  for (const hash of [
    state.sourceScopeSha256,
    state.archiveSha256,
    state.manifestSha256,
    state.receiptSha256,
  ])
    assert.match(hash, sha256Pattern)
  assert.ok(
    Number.isInteger(state.port) && state.port >= 1024 && state.port <= 65535
  )
  assert.equal(state.containerName, `rr-pg16-target-${state.owner}`)
  assert.equal(state.volumeName, `rr-pg16-target-${state.owner}`)
  assert.match(state.createdAt, /^\d{4}-\d{2}-\d{2}T/u)
  assert.ok(
    state.containerId === null || containerIdPattern.test(state.containerId)
  )
  assert.ok(
    state.targetSystemId === null ||
      (sourceIdPattern.test(state.targetSystemId) &&
        state.targetSystemId !== state.sourceSystemId)
  )
  if (state.phase !== "provisioning") {
    assert.ok(state.containerId && state.targetSystemId)
  }
  return state
}

export const writeState = async (state) => {
  const directory = await openPrivateOutputDirectory(state.root)
  const temporary = join(directory.descriptorPath, `.state-${randomUUID()}`)
  let renamed = false
  try {
    const handle = await open(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600
    )
    try {
      await handle.writeFile(`${JSON.stringify(state)}\n`)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await directory.assertStable()
    await rename(temporary, join(directory.descriptorPath, "state.json"))
    renamed = true
    await directory.sync()
    await directory.assertStable()
  } finally {
    try {
      if (!renamed) await rm(temporary, { force: true })
    } finally {
      await directory.close()
    }
  }
}

const dockerObject = async (kind, name) => {
  const raw = await docker([kind, "inspect", name], { maxBytes: 131_072 })
  const parsed = JSON.parse(raw)
  assert.ok(Array.isArray(parsed) && parsed.length === 1)
  return parsed[0]
}

const inspectResources = async (state, { requireRunning = true } = {}) => {
  assert.equal(await localDockerIdentity(), state.daemonId)
  const image = await dockerObject("image", imageId)
  assert.equal(image.Id, imageId)
  const volume = await dockerObject("volume", state.volumeName)
  const container = await dockerObject("container", state.containerName)
  assertContainerBoundary(state, container, volume, { requireRunning })
  return { container, volume }
}

export const assertContainerBoundary = (
  state,
  container,
  volume,
  { requireRunning = true } = {}
) => {
  assert.equal(volume.Name, state.volumeName)
  assert.equal(volume.Driver, "local")
  assert.equal(volume.Labels?.[ownerLabel], state.owner)
  assert.equal(container.Id, state.containerId)
  assert.equal(container.Image, imageId)
  assert.equal(container.Config?.User, imageUser)
  assert.equal(container.Config?.Labels?.[ownerLabel], state.owner)
  assert.equal(container.HostConfig?.NetworkMode, "none")
  assert.equal(container.HostConfig?.ReadonlyRootfs, true)
  assert.equal(container.HostConfig?.Privileged, false)
  assert.ok(container.HostConfig?.CapDrop?.includes("ALL"))
  assert.ok(
    container.HostConfig?.SecurityOpt?.some((entry) =>
      entry.startsWith("no-new-privileges")
    )
  )
  assert.ok(
    !container.HostConfig?.PortBindings ||
      Object.keys(container.HostConfig.PortBindings).length === 0
  )
  assert.equal(container.HostConfig?.Memory, 1024 * 1024 * 1024)
  assert.equal(container.HostConfig?.PidsLimit, 256)
  assert.equal(container.HostConfig?.NanoCpus, 2_000_000_000)
  assert.ok(container.Config?.Cmd?.includes("listen_addresses="))
  assert.ok(
    container.Config?.Cmd?.includes(`unix_socket_directories=${socketPath}`)
  )
  const mounts = container.Mounts ?? []
  assert.equal(mounts.length, 2)
  assert.ok(
    mounts.some(
      (mount) =>
        mount.Type === "volume" &&
        mount.Name === state.volumeName &&
        mount.Destination === dataPath &&
        mount.RW === true
    )
  )
  assert.ok(
    mounts.some(
      (mount) =>
        mount.Type === "bind" &&
        mount.Source === join(state.root, "socket") &&
        mount.Destination === socketPath &&
        mount.RW === true
    )
  )
  if (requireRunning) assert.equal(container.State?.Running, true)
}

const openRelay = async (state) => {
  const sockets = new Set()
  const destination = join(state.root, "socket", ".s.PGSQL.5432")
  const server = createServer((incoming) => {
    if (sockets.size >= 16) {
      incoming.destroy()
      return
    }
    const outgoing = createConnection({ path: destination })
    sockets.add(incoming)
    sockets.add(outgoing)
    for (const socket of [incoming, outgoing]) {
      socket.setTimeout(30_000, () => socket.destroy())
      socket.on("error", () => socket.destroy())
      socket.on("close", () => sockets.delete(socket))
    }
    incoming.pipe(outgoing)
    outgoing.pipe(incoming)
  })
  await new Promise((resolveListen, reject) => {
    server.once("error", reject)
    server.listen(state.port, "127.0.0.1", () => {
      server.off("error", reject)
      resolveListen()
    })
  })
  return async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise((resolveClose) => server.close(resolveClose))
  }
}

const targetEnvironment = (state, password) => ({
  ...safeEnvironment(),
  PGHOST: "127.0.0.1",
  PGPORT: String(state.port),
  PGUSER: "postgres",
  PGPASSWORD: password,
  PGDATABASE: "postgres",
  PGSSLMODE: "disable",
  PGCONNECT_TIMEOUT: "5",
})

const targetUrl = (state, password) =>
  `postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:${state.port}/postgres?sslmode=disable`

const query = (state, password, sql, timeoutMs = 10_000, maxBytes = 65_536) =>
  runBounded(
    psqlPath,
    [
      "--no-psqlrc",
      "--no-password",
      "--quiet",
      "--tuples-only",
      "--no-align",
      "--set=ON_ERROR_STOP=1",
      `--command=${sql}`,
    ],
    { environment: targetEnvironment(state, password), timeoutMs, maxBytes }
  )

const targetFactsSql = `SELECT pg_catalog.json_build_object(
  'serverVersionNum', pg_catalog.current_setting('server_version_num'),
  'encoding', pg_catalog.current_setting('server_encoding'),
  'collate', datcollate,
  'ctype', datctype,
  'declaredCollationVersion', datcollversion,
  'actualCollationVersion', pg_catalog.pg_database_collation_actual_version(oid),
  'systemId', (SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
  'database', pg_catalog.current_database()
) FROM pg_catalog.pg_database WHERE datname = pg_catalog.current_database();`

const verifyTarget = async (state, { expectEmpty = true, receipt } = {}) => {
  await canonicalPrivateDirectory(state.root)
  await inspectResources(state)
  const passwordMetadata = await lstat(join(state.root, "password"))
  assert.ok(passwordMetadata.isFile() && !passwordMetadata.isSymbolicLink())
  assert.equal(passwordMetadata.uid, process.getuid())
  assert.equal(passwordMetadata.mode & 0o007, 0)
  const socketDirectory = await lstat(join(state.root, "socket"))
  assert.ok(socketDirectory.isDirectory() && !socketDirectory.isSymbolicLink())
  assert.equal(socketDirectory.uid, process.getuid())
  assert.equal(socketDirectory.mode & 0o007, 0)
  const socket = await lstat(join(state.root, "socket", ".s.PGSQL.5432"))
  assert.ok(socket.isSocket())
  assert.equal(socket.uid, 999)
  assert.equal(socket.mode & 0o777, 0o777)
  const password = (await readFile(join(state.root, "password"), "utf8")).trim()
  assert.match(password, /^[A-Za-z0-9_-]{40,64}$/u)
  const closeRelay = await openRelay(state)
  try {
    const facts = JSON.parse(await query(state, password, targetFactsSql))
    assert.deepEqual(Object.keys(facts).sort(), [
      "actualCollationVersion",
      "collate",
      "ctype",
      "database",
      "declaredCollationVersion",
      "encoding",
      "serverVersionNum",
      "systemId",
    ])
    assert.equal(facts.serverVersionNum, "160015")
    assert.equal(facts.encoding, "UTF8")
    assert.equal(facts.collate, "en_US.utf8")
    assert.equal(facts.ctype, "en_US.utf8")
    assert.equal(facts.declaredCollationVersion, "2.41")
    assert.equal(facts.actualCollationVersion, "2.41")
    assert.equal(facts.database, "postgres")
    assert.match(facts.systemId, sourceIdPattern)
    assert.notEqual(facts.systemId, state.sourceSystemId)
    if (state.targetSystemId) assert.equal(facts.systemId, state.targetSystemId)
    const hba = JSON.parse(
      await query(
        state,
        password,
        "SELECT COALESCE(pg_catalog.json_agg(pg_catalog.json_build_object('type',type,'authMethod',auth_method,'error',error)),'[]'::json) FROM pg_catalog.pg_hba_file_rules"
      )
    )
    assert.ok(Array.isArray(hba) && hba.length >= 2)
    assert.ok(hba.some((rule) => rule.type === "local"))
    for (const rule of hba) {
      assert.equal(rule.error, null)
      assert.equal(
        rule.authMethod,
        rule.type === "local" ? "scram-sha-256" : "reject"
      )
    }
    if (expectEmpty) {
      const inventory = parseRestoreInventory(
        await query(state, password, RESTORE_TARGET_PREFLIGHT_SQL)
      )
      assert.deepEqual(inventory, { objects: 0, tables: 0 })
    } else {
      assert.ok(receipt)
      const tables = parseRestoreTableList(
        await query(state, password, RESTORE_TABLE_LIST_SQL)
      )
      const invariants = parseRestoreInvariants(
        await query(state, password, buildRestoreInvariantsSql(tables), 120_000)
      )
      assert.deepEqual(invariants, receipt.invariants)
    }
    return { facts, password }
  } finally {
    await closeRelay()
  }
}

const selectedPort = async () => {
  const server = createServer()
  await new Promise((resolveListen, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolveListen)
  })
  const address = server.address()
  await new Promise((resolveClose) => server.close(resolveClose))
  assert.ok(address && typeof address !== "string")
  return address.port
}

const create = async (baseDir, paths, signal) => {
  signal?.throwIfAborted()
  await runCreatePhase("base_directory", () =>
    canonicalPrivateDirectory(baseDir)
  )
  const { scope, hashes } = await runCreatePhase("source_bundle", () =>
    verifySourceScope(paths)
  )
  const daemonId = await runCreatePhase("docker_daemon", localDockerIdentity)
  await runCreatePhase("image_identity", async () => {
    const image = await dockerObject("image", imageId)
    assert.equal(image.Id, imageId)
  })
  await runCreatePhase("client_toolchain", async () => {
    const clientVersion = await runBounded(psqlPath, ["--version"])
    assert.match(clientVersion, /^psql \(PostgreSQL\) 16\.15(?:\s|$)/u)
    const restoreVersion = await runBounded(
      "/usr/lib/postgresql/16/bin/pg_restore",
      ["--version"]
    )
    assert.match(restoreVersion, /^pg_restore \(PostgreSQL\) 16\.15(?:\s|$)/u)
  })
  await runCreatePhase("disk_capacity", async () => {
    const disk = await statfs(baseDir)
    assert.ok(disk.bavail * disk.bsize >= 512 * 1024 * 1024)
  })
  const port = await runCreatePhase("port_selection", selectedPort)
  const owner = randomUUID().replaceAll("-", "")
  const root = join(baseDir, `pg16-target-${owner}`)
  await runCreatePhase("target_directory", () => mkdir(root, { mode: 0o700 }))
  const state = {
    schemaVersion: 1,
    owner,
    root,
    createdAt: new Date().toISOString(),
    daemonId,
    imageId,
    sourceSystemId: scope.sourceSystemId,
    ...paths,
    ...hashes,
    targetSystemId: null,
    containerName: `rr-pg16-target-${owner}`,
    containerId: null,
    volumeName: `rr-pg16-target-${owner}`,
    port,
    phase: "provisioning",
  }
  let subphase = "local_access"
  try {
    await mkdir(join(root, "socket"), { mode: 0o700 })
    const password = randomBytes(36).toString("base64url")
    await writeFile(join(root, "password"), `${password}\n`, {
      flag: "wx",
      mode: 0o600,
    })
    await runBounded("setfacl", ["-m", "u:999:rwx", join(root, "socket")])
    await runBounded("setfacl", ["-m", "u:999:r--", join(root, "password")])
    subphase = "state_persist"
    await writeState(state)
    subphase = "volume_create"
    await docker(
      [
        "volume",
        "create",
        "--label",
        `${ownerLabel}=${owner}`,
        state.volumeName,
      ],
      { signal }
    )
    subphase = "cluster_init"
    await docker(
      [
        "run",
        "--rm",
        "--pull",
        "never",
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--memory",
        "1g",
        "--pids-limit",
        "256",
        "--cpus",
        "2",
        "--user",
        imageUser,
        "--mount",
        `type=volume,source=${state.volumeName},target=${dataPath}`,
        "--mount",
        `type=bind,source=${join(root, "password")},target=/run/password,readonly`,
        "--entrypoint",
        "/opt/postgresql/bin/initdb",
        imageId,
        "-D",
        dataPath,
        "-U",
        "postgres",
        "--pwfile=/run/password",
        "--auth-local=scram-sha-256",
        "--auth-host=reject",
        "--locale=en_US.utf8",
        "--encoding=UTF8",
        "--no-instructions",
      ],
      { timeoutMs: 60_000, signal }
    )
    subphase = "server_start"
    const id = await docker(
      [
        "run",
        "--detach",
        "--name",
        state.containerName,
        "--label",
        `${ownerLabel}=${owner}`,
        "--pull",
        "never",
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--memory",
        "1g",
        "--pids-limit",
        "256",
        "--cpus",
        "2",
        "--shm-size",
        "128m",
        "--user",
        imageUser,
        "--mount",
        `type=volume,source=${state.volumeName},target=${dataPath}`,
        "--mount",
        `type=bind,source=${join(root, "socket")},target=${socketPath}`,
        imageId,
        "-D",
        dataPath,
        "-c",
        "listen_addresses=",
        "-c",
        `unix_socket_directories=${socketPath}`,
        "-c",
        "unix_socket_permissions=0777",
        "-c",
        "fsync=on",
      ],
      { timeoutMs: 30_000, signal }
    )
    assert.match(id, containerIdPattern)
    state.containerId = id
    subphase = "state_persist"
    await writeState(state)
    subphase = "target_verify"
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      try {
        if ((await stat(join(root, "socket", ".s.PGSQL.5432"))).isSocket())
          break
      } catch {}
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
    }
    const { facts } = await verifyTarget(state)
    signal?.throwIfAborted()
    state.targetSystemId = facts.systemId
    state.phase = "ready"
    subphase = "state_persist"
    await writeState(state)
    signal?.throwIfAborted()
    return {
      status: "isolated_target_ready",
      targetDir: root,
      imageId,
      containerId: id,
      targetSystemId: facts.systemId,
      sourceSystemId: scope.sourceSystemId,
    }
  } catch {
    await finishFailedCreate(createPhaseFailure(subphase), async () => {
      await cleanupResources(state)
      await rm(root, { recursive: true })
    })
  }
}

const cleanupResources = async (state) => {
  assert.equal(await localDockerIdentity(), state.daemonId)
  const namedContainers = await docker([
    "container",
    "ls",
    "--all",
    "--filter",
    `name=^/${state.containerName}$`,
    "--format",
    "{{.ID}} {{.Names}}",
  ])
  const containers = await docker([
    "container",
    "ls",
    "--all",
    "--filter",
    `label=${ownerLabel}=${state.owner}`,
    "--format",
    "{{.ID}} {{.Names}}",
  ])
  const listedContainers = containers ? containers.split("\n") : []
  assert.ok(listedContainers.length <= 1)
  assert.equal(namedContainers, containers)
  if (listedContainers.length === 1) {
    const [shortId, name] = listedContainers[0].split(" ")
    assert.equal(name, state.containerName)
    const container = await dockerObject("container", name)
    assert.ok(container.Id.startsWith(shortId))
    if (state.containerId) assert.equal(container.Id, state.containerId)
    assert.equal(container.Config?.Labels?.[ownerLabel], state.owner)
    assert.equal(container.Image, imageId)
    await docker(["container", "rm", "--force", container.Id])
  }
  const namedVolumes = await docker([
    "volume",
    "ls",
    "--filter",
    `name=^${state.volumeName}$`,
    "--format",
    "{{.Name}}",
  ])
  const volumes = await docker([
    "volume",
    "ls",
    "--filter",
    `label=${ownerLabel}=${state.owner}`,
    "--format",
    "{{.Name}}",
  ])
  const listedVolumes = volumes ? volumes.split("\n") : []
  assert.ok(listedVolumes.length <= 1)
  assert.equal(namedVolumes, volumes)
  if (listedVolumes.length === 1) {
    assert.equal(listedVolumes[0], state.volumeName)
    const volume = await dockerObject("volume", state.volumeName)
    assert.equal(volume.Labels?.[ownerLabel], state.owner)
    await docker(["volume", "rm", state.volumeName])
  }
}

const restore = async (
  state,
  options,
  apply,
  signal,
  runRestoreCommand = runBounded
) => {
  signal?.throwIfAborted()
  assert.equal(state.phase, "ready")
  if (apply) assert.match(options["--confirm"], /^[a-f0-9]{64}$/u)
  await assertSourceScope(state)
  const archiveMetadata = await lstat(state.archivePath)
  assert.ok(archiveMetadata.isFile() && !archiveMetadata.isSymbolicLink())
  assert.ok(archiveMetadata.size > 0 && archiveMetadata.size <= maxArchiveBytes)
  const free = await statfs(state.root)
  assert.ok(
    free.bavail * free.bsize >= archiveMetadata.size * 2 + 512 * 1024 * 1024
  )
  const dockerRoot = await docker(["info", "--format", "{{.DockerRootDir}}"])
  const dockerFree = await statfs(dockerRoot)
  assert.ok(
    dockerFree.bavail * dockerFree.bsize >=
      archiveMetadata.size * 2 + 512 * 1024 * 1024
  )
  await verifyTarget(state)
  signal?.throwIfAborted()
  const password = (await readFile(join(state.root, "password"), "utf8")).trim()
  const connection = createPostgresClientEnvironment(
    targetUrl(state, password),
    "DATABASE_RESTORE_URL"
  )
  if (apply) assert.equal(options["--confirm"], connection.fingerprint)
  const snapshot = await snapshotSource(state, signal)
  try {
    const args = [
      restorePath,
      "--archive",
      snapshot.paths.archivePath,
      "--manifest",
      snapshot.paths.manifestPath,
      "--receipt",
      snapshot.paths.receiptPath,
      ...(apply ? ["--apply"] : []),
    ]
    if (apply) {
      state.phase = "restore_attempted"
      await writeState(state)
    }
    signal?.throwIfAborted()
    const closeRelay = await openRelay(state)
    try {
      const environment = {
        ...safeEnvironment(),
        DATABASE_RESTORE_URL: targetUrl(state, password),
        DATABASE_RECOVERY_TIMEOUT_MS: "1800000",
        DATABASE_RESTORE_MAX_ARCHIVE_BYTES: String(maxArchiveBytes),
        ...(apply ? { DATABASE_RESTORE_CONFIRM: options["--confirm"] } : {}),
      }
      const result = JSON.parse(
        await runRestoreCommand(process.execPath, args, {
          timeoutMs: 31 * 60_000,
          maxBytes: 8192,
          environment,
          signal,
          killSignal: "SIGTERM",
        })
      )
      signal?.throwIfAborted()
      assert.equal(
        result.status,
        apply ? "restore_verified" : "dry_run_verified"
      )
      if (apply) {
        state.phase = "restored"
        await writeState(state)
        signal?.throwIfAborted()
        return {
          status: "isolated_restore_verified",
          targetDir: state.root,
          sourceChecksum: result.sourceChecksum,
          targetTables: result.targetTables,
          verifiedRows: result.verifiedRows,
        }
      }
      return {
        status: "isolated_preflight_verified",
        targetDir: state.root,
        confirmation: result.confirmation,
        sourceChecksum: result.sourceChecksum,
      }
    } finally {
      await closeRelay()
    }
  } finally {
    await rm(snapshot.directory, { recursive: true, force: true })
  }
}

export const parseArguments = (args) => {
  const normalized = normalizeScriptArguments(args)
  if (normalized.length === 1 && normalized[0] === "--help")
    return { mode: "help" }
  const [mode, ...tail] = normalized
  assert.ok(
    [
      "create",
      "verify",
      "preflight",
      "apply",
      "business-parity",
      "stripe-parity",
      "cleanup",
    ].includes(mode)
  )
  const allowed = {
    create: [
      "--base-dir",
      "--source-scope",
      "--archive",
      "--manifest",
      "--receipt",
    ],
    verify: ["--target-dir"],
    preflight: ["--target-dir"],
    apply: ["--target-dir", "--confirm"],
    "business-parity": ["--target-dir"],
    "stripe-parity": ["--target-dir", "--output"],
    cleanup: ["--target-dir"],
  }[mode]
  assert.equal(tail.length, allowed.length * 2)
  const options = {}
  for (let index = 0; index < tail.length; index += 2) {
    const key = tail[index]
    const value = tail[index + 1]
    assert.ok(allowed.includes(key) && !(key in options))
    assert.ok(value && !value.startsWith("--"))
    options[key] = value
  }
  assert.deepEqual(Object.keys(options).sort(), [...allowed].sort())
  return { mode, options }
}

export const main = async (
  args = process.argv.slice(2),
  { signal, runRestoreCommand, runStripeRead = runStripeBusinessParity } = {}
) => {
  signal?.throwIfAborted()
  const { mode, options } = parseArguments(args)
  if (mode === "help") return help
  if (mode === "create")
    return create(
      options["--base-dir"],
      {
        sourceScopePath: options["--source-scope"],
        archivePath: options["--archive"],
        manifestPath: options["--manifest"],
        receiptPath: options["--receipt"],
      },
      signal
    )
  const state = await readState(options["--target-dir"])
  return withTargetLock(state.root, async () => {
    if (mode === "cleanup") {
      await cleanupResources(state)
      await rm(state.root, { recursive: true })
      return { status: "isolated_target_removed" }
    }
    if (mode === "verify") {
      assert.ok(state.phase === "ready" || state.phase === "restored")
      const receipt = await assertSourceScope(state)
      const { facts } = await verifyTarget(state, {
        expectEmpty: state.phase === "ready",
        receipt,
      })
      return {
        status:
          state.phase === "ready"
            ? "isolated_target_verified"
            : "isolated_restored_target_verified",
        targetDir: state.root,
        imageId,
        containerId: state.containerId,
        targetSystemId: facts.systemId,
      }
    }
    if (mode === "business-parity") {
      assert.equal(state.phase, "restored")
      const receipt = await assertSourceScope(state)
      const { facts, password } = await verifyTarget(state, {
        expectEmpty: false,
        receipt,
      })
      const closeRelay = await openRelay(state)
      try {
        parseBusinessParitySchema(
          await query(state, password, businessParitySchemaSql, 10_000)
        )
        const report = parseBusinessParityOutput(
          await query(state, password, businessParitySql, 10_000)
        )
        assert.equal(
          JSON.parse(await query(state, password, targetFactsSql)).systemId,
          facts.systemId
        )
        await assertSourceScope(state)
        return report
      } finally {
        await closeRelay()
      }
    }
    if (mode === "stripe-parity") {
      assert.equal(state.phase, "restored")
      const outputPath = options["--output"]
      assert.equal(resolve(outputPath), outputPath)
      await canonicalPrivateDirectory(dirname(outputPath))
      const expectedAccountId = process.env.RR_STRIPE_EXPECTED_ACCOUNT_ID
      const apiKey = process.env.STRIPE_API_KEY
      assert.ok(/^acct_[A-Za-z0-9]{1,251}$/.test(expectedAccountId ?? ""))
      assert.ok(/^(?:sk|rk)_test_[A-Za-z0-9_]+$/.test(apiKey ?? ""))
      assert.equal(
        process.env.RAILWAY_PROJECT_ID,
        "1f39263a-25e4-4d69-abc2-f0287b331d1e"
      )
      assert.equal(
        process.env.RAILWAY_ENVIRONMENT_ID,
        "799a2f98-f819-495d-b8b6-12e71af86568"
      )
      assert.equal(
        process.env.RAILWAY_SERVICE_ID,
        "99d4fd5e-955b-416a-9078-0266bcf949d2"
      )
      assert.equal(process.env.RAILWAY_SERVICE_NAME, "Backend")
      const receipt = await assertSourceScope(state)
      const scopeBytes = await readFile(state.sourceScopePath)
      assert.equal(sha256(scopeBytes), state.sourceScopeSha256)
      const scope = JSON.parse(scopeBytes.toString("utf8"))
      assert.equal(scope.source.projectId, process.env.RAILWAY_PROJECT_ID)
      assert.equal(
        scope.source.environmentId,
        process.env.RAILWAY_ENVIRONMENT_ID
      )
      const { facts, password } = await verifyTarget(state, {
        expectEmpty: false,
        receipt,
      })
      const closeRelay = await openRelay(state)
      let providerReport
      try {
        parseBusinessParitySchema(
          await query(state, password, businessParitySchemaSql, 10_000)
        )
        const internalReport = parseBusinessParityOutput(
          await query(state, password, businessParitySql, 10_000)
        )
        assert.equal(
          internalReport.scanned.payments,
          internalReport.scanned.stripePayments
        )
        for (const [key, count] of Object.entries(internalReport.mismatches))
          if (
            key !== "stripePaymentTaxEvidenceMissing" &&
            key !== "taxAmountUsd"
          )
            assert.equal(count, 0)
        const records = parsePostgresStripeDescriptor(
          await query(
            state,
            password,
            postgresStripeDescriptorSql,
            10_000,
            8192
          ),
          {
            payments: internalReport.scanned.stripePayments,
            taxEvidence: internalReport.scanned.taxEvidence,
          }
        )
        signal?.throwIfAborted()
        providerReport = parseStripeBusinessParityReport(
          JSON.stringify(
            await runStripeRead(records, {
              apiKey,
              expectedAccountId,
              signal,
            })
          ),
          {
            payments: records.length,
            taxEvidence: internalReport.scanned.taxEvidence,
          }
        )
        signal?.throwIfAborted()
        assert.equal(
          JSON.parse(await query(state, password, targetFactsSql)).systemId,
          facts.systemId
        )
        await assertSourceScope(state)
      } finally {
        await closeRelay()
      }
      const report = {
        ...providerReport,
        source: "verified_isolated_postgres_restore_and_stripe_test_mode",
        sourceScopeSha256: state.sourceScopeSha256,
      }
      const output = await open(outputPath, "wx", 0o600)
      let accepted = false
      try {
        await output.writeFile(`${JSON.stringify(report)}\n`)
        await output.sync()
        accepted = true
      } finally {
        await output.close()
        if (!accepted) await rm(outputPath, { force: true })
      }
      const outputMetadata = await lstat(outputPath)
      assert.ok(outputMetadata.isFile() && !outputMetadata.isSymbolicLink())
      assert.equal(outputMetadata.mode & 0o077, 0)
      return {
        status: "stripe_parity_reported",
        output: outputPath,
        accountVerified: true,
        businessReconciled: false,
      }
    }
    return restore(state, options, mode === "apply", signal, runRestoreCommand)
  })
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  process.once("SIGINT", abort)
  process.once("SIGTERM", abort)
  try {
    const result = await main(process.argv.slice(2), {
      signal: controller.signal,
    })
    if (
      controller.signal.aborted &&
      result?.status === "isolated_target_ready"
    ) {
      await main(["cleanup", "--target-dir", result.targetDir])
    }
    controller.signal.throwIfAborted()
    process.stdout.write(
      typeof result === "string" ? result : `${JSON.stringify(result)}\n`
    )
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify(isolatedTargetFailureEvent(error))}\n`
    )
    process.exitCode = 1
  } finally {
    process.off("SIGINT", abort)
    process.off("SIGTERM", abort)
  }
}
