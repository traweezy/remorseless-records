import { createHash, randomUUID } from "node:crypto"
import { constants } from "node:fs"
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rm,
  statfs,
} from "node:fs/promises"
import { basename, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  parseAofManifest,
  verifyRedisAofArchive,
} from "./lib/redis-aof-recovery.mjs"
import {
  createRecoveryScope,
  runRecoveryCommand,
} from "./lib/recovery-process.mjs"

const checker = fileURLToPath(
  new URL("./lib/redis-aof-pinned-checker.sh", import.meta.url)
)
// A reviewed, committed wrapper: this hash does not replace the image and
// checker-binary SHA pins enforced inside the wrapper.
const checkerSha256 =
  "8feaba3a17022480750cccca41bba3aa5b71ae6dc3ac7ff5a0bdf5d9b33f9b33"
const redisCheckerBinarySha256 =
  "c9ed119a46bfe87ace4048eb22479da7d3ca4857f0ea5b1d1729e212bc5aabca"
const manifestName = "appendonly.aof.manifest"
const sha256Pattern = /^[a-f0-9]{64}$/u
const imageIdPattern = /^sha256:[a-f0-9]{64}$/u
const uuidPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u
const scopeKeys = [
  "projectId",
  "environmentId",
  "serviceId",
  "deploymentId",
  "instanceId",
  "volumeId",
  "volumeInstanceId",
]
const maxManifestBytes = 16 * 1024
const maxReceiptBytes = 64 * 1024
const maxFiles = 33
const copyBufferBytes = 64 * 1024
const targetMemoryBytes = 1024 * 1024 * 1024
const help = `Usage: node scripts/redis-aof-isolated-replay.mjs \\
  --archive-dir <absolute-private-appendonlydir> \\
  --capture-receipt <absolute-private-capture.receipt.json> \\
  --receipt-sha256 <independently-recorded-lowercase-sha256> \\
  --image-id <reviewed-scanned-local-redis-image-sha256>

Copy a capture into private storage, bind every AOF file to the receipt,
verify the copy with a digest-pinned Redis 8.10.1 checker, then replay it in
a disposable worker-free Redis 8.10.1 container. The target has no network,
published port, provider credentials, or live-service connection. It is
removed after bounded startup and restart evidence. This does not reconcile
BullMQ queues or business state and does not authorize a cutover.

Required local Docker default context must resolve to a Unix socket. Both the
official checker image and the reviewed target image must already be present;
no pull or build occurs. The target image ID must come from a separate image
scan/review, not from this command. The receipt SHA must be recorded outside
the mutable capture bundle. Redis data can be sensitive; output omits keys,
values, source paths, and raw checker or container diagnostics.

Optional environment:
  REDIS_AOF_REPLAY_MAX_BYTES   Copy budget, 1 to 10737418240 (default 536870912)
  REDIS_AOF_REPLAY_TIMEOUT_MS Overall deadline, 100 to 600000 (default 120000)
`
const failure = () => new Error("Redis isolated replay unavailable.")
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex")
const decimal = (raw, fallback, maximum) => {
  if (raw === undefined) return fallback
  if (!/^[1-9]\d*$/u.test(raw)) throw failure()
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value > maximum) throw failure()
  return value
}

export const parseReplayArguments = (args, environment = process.env) => {
  const normalized = args[0] === "--" ? args.slice(1) : args
  if (normalized.length === 1 && normalized[0] === "--help")
    return { mode: "help" }
  const flags = [
    "--archive-dir",
    "--capture-receipt",
    "--receipt-sha256",
    "--image-id",
  ]
  if (normalized.length !== flags.length * 2) throw failure()
  const options = new Map()
  for (let index = 0; index < normalized.length; index += 2) {
    const flag = normalized[index]
    const value = normalized[index + 1]
    if (!flags.includes(flag) || options.has(flag) || !value) throw failure()
    options.set(flag, value)
  }
  for (const path of [
    options.get("--archive-dir"),
    options.get("--capture-receipt"),
  ])
    if (
      !isAbsolute(path) ||
      resolve(path) !== path ||
      Buffer.byteLength(path) > 1024
    )
      throw failure()
  const receiptSha256 = options.get("--receipt-sha256")
  const imageId = options.get("--image-id")
  if (!sha256Pattern.test(receiptSha256) || !imageIdPattern.test(imageId))
    throw failure()
  const maxBytes = decimal(
    environment.REDIS_AOF_REPLAY_MAX_BYTES,
    512 * 1024 * 1024,
    10 * 1024 ** 3
  )
  const timeoutMs = decimal(
    environment.REDIS_AOF_REPLAY_TIMEOUT_MS,
    120_000,
    600_000
  )
  if (timeoutMs < 100) throw failure()
  return {
    mode: "replay",
    archiveDirectory: options.get("--archive-dir"),
    receiptPath: options.get("--capture-receipt"),
    receiptSha256,
    imageId,
    maxBytes,
    timeoutMs,
  }
}

const sameFile = (left, right) =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.size === right.size &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs

const privateDirectory = async (path) => {
  const before = await lstat(path, { bigint: true })
  if (
    !before.isDirectory() ||
    before.isSymbolicLink() ||
    (before.mode & 0o077n) !== 0n ||
    (process.getuid && before.uid !== BigInt(process.getuid())) ||
    (await realpath(path)) !== path
  )
    throw failure()
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  )
  const opened = await handle.stat({ bigint: true })
  if (!sameFile(before, opened)) {
    await handle.close()
    throw failure()
  }
  return handle
}

const privateFile = async (path, limit) => {
  const before = await lstat(path, { bigint: true })
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1n ||
    (before.mode & 0o077n) !== 0n ||
    (process.getuid && before.uid !== BigInt(process.getuid())) ||
    before.size < 0n ||
    before.size > BigInt(limit)
  )
    throw failure()
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  )
  const opened = await handle.stat({ bigint: true })
  if (!sameFile(before, opened)) {
    await handle.close()
    throw failure()
  }
  return { handle, size: Number(opened.size), opened }
}

const boundedRead = async (path, limit, signal) => {
  const { handle, size, opened } = await privateFile(path, limit)
  try {
    const buffer = Buffer.alloc(size + 1)
    let offset = 0
    while (offset < buffer.length) {
      signal.throwIfAborted()
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset
      )
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (
      offset !== size ||
      !sameFile(opened, await handle.stat({ bigint: true }))
    )
      throw failure()
    return buffer.subarray(0, offset)
  } finally {
    await handle.close()
  }
}

export const validateCaptureReceipt = (receipt, manifest, maxBytes) => {
  if (
    receipt?.schemaVersion !== 1 ||
    receipt.rewriteRestored !== true ||
    !sha256Pattern.test(receipt.sourceFingerprint ?? "") ||
    !sha256Pattern.test(receipt.runIdSha256 ?? "") ||
    !sha256Pattern.test(receipt.manifestSha256 ?? "") ||
    receipt.manifestSha256 !== hash(manifest) ||
    !Array.isArray(receipt.files) ||
    receipt.files.length > maxFiles ||
    !Number.isSafeInteger(receipt.totalBytes) ||
    receipt.totalBytes > maxBytes ||
    !receipt.source ||
    scopeKeys.some((key) => !uuidPattern.test(receipt.source[key] ?? "")) ||
    receipt.source.mountPath !== "/bitnami"
  )
    throw failure()
  const entries = parseAofManifest(
    new TextDecoder("utf-8", { fatal: true }).decode(manifest)
  )
  const names = [manifestName, ...entries.map(({ name }) => name)]
  if (receipt.files.length !== names.length) throw failure()
  let total = 0
  for (const [index, file] of receipt.files.entries()) {
    if (
      file?.name !== names[index] ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      !sha256Pattern.test(file.sha256 ?? "")
    )
      throw failure()
    total += file.bytes
  }
  if (
    total !== receipt.totalBytes ||
    receipt.files[0].sha256 !== receipt.manifestSha256
  )
    throw failure()
  return receipt.files
}

const copyFileBounded = async (source, target, expected, signal) => {
  const {
    handle: input,
    size,
    opened,
  } = await privateFile(source, expected.bytes)
  let output
  try {
    if (size !== expected.bytes) throw failure()
    output = await open(
      target,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600
    )
    const digest = createHash("sha256")
    const buffer = Buffer.alloc(copyBufferBytes)
    let count = 0
    while (count < size) {
      signal.throwIfAborted()
      const { bytesRead } = await input.read(
        buffer,
        0,
        Math.min(buffer.length, size - count)
      )
      if (bytesRead <= 0) throw failure()
      digest.update(buffer.subarray(0, bytesRead))
      let written = 0
      while (written < bytesRead) {
        const result = await output.write(buffer, written, bytesRead - written)
        if (result.bytesWritten <= 0) throw failure()
        written += result.bytesWritten
      }
      count += bytesRead
    }
    if (
      digest.digest("hex") !== expected.sha256 ||
      !sameFile(opened, await input.stat({ bigint: true }))
    )
      throw failure()
    await output.sync()
  } finally {
    await output?.close()
    await input.close()
  }
}

const dockerEnvironment = (environment) => ({
  HOME: environment.HOME,
  PATH: environment.PATH,
  LANG: "C",
})

const dockerCommand =
  (runCommand, environment, signal) =>
  (args, maxOutputBytes = 4096) =>
    runCommand("/usr/bin/docker", ["--context", "default", ...args], {
      environment: dockerEnvironment(environment),
      signal,
      maxOutputBytes,
    })

const assertDockerSource = async (runDocker, imageId) => {
  const host = await runDocker([
    "context",
    "inspect",
    "default",
    "--format",
    "{{json .Endpoints.docker.Host}}",
  ])
  if (!/^"unix:\/\/\/[^"\r\n]+"$/u.test(host)) throw failure()
  const image = await runDocker([
    "image",
    "inspect",
    "--format",
    "{{.Id}}|{{.Architecture}}|{{.Os}}",
    imageId,
  ])
  if (image !== `${imageId}|amd64|linux`) throw failure()
  const checkerHash = await runDocker([
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
    "128m",
    "--pids-limit",
    "32",
    "--entrypoint",
    "sha256sum",
    imageId,
    "/usr/local/bin/redis-check-aof",
  ])
  if (
    checkerHash !==
    `${redisCheckerBinarySha256}  /usr/local/bin/redis-check-aof`
  )
    throw failure()
}

const assertContainer = (container, imageId, name, token, data, socket) => {
  if (
    container?.Image !== imageId ||
    container.Name !== `/${name}` ||
    container.Config?.Labels?.["com.remorseless-records.recovery-run"] !==
      token ||
    container.HostConfig?.NetworkMode !== "none" ||
    container.HostConfig?.ReadonlyRootfs !== true ||
    container.HostConfig?.Privileged !== false ||
    container.HostConfig?.Memory !== targetMemoryBytes ||
    container.HostConfig?.MemorySwap !== targetMemoryBytes ||
    container.HostConfig?.PidsLimit !== 64 ||
    !container.HostConfig?.CapDrop?.includes("ALL") ||
    !container.HostConfig?.SecurityOpt?.includes("no-new-privileges") ||
    Object.keys(container.HostConfig?.PortBindings ?? {}).length !== 0 ||
    !Array.isArray(container.Mounts) ||
    container.Mounts.length !== 2
  )
    throw failure()
  const mounts = new Map(
    container.Mounts.map((mount) => [mount.Destination, mount])
  )
  for (const [destination, source] of [
    ["/data", data],
    ["/socket", socket],
  ]) {
    const mount = mounts.get(destination)
    if (mount?.Type !== "bind" || mount.Source !== source || mount.RW !== true)
      throw failure()
  }
}

const waitForRedis = async (runDocker, id, signal) => {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    signal.throwIfAborted()
    try {
      const answer = await runDocker(
        [
          "exec",
          "--user",
          `${process.getuid()}:${process.getgid()}`,
          id,
          "redis-cli",
          "-s",
          "/socket/redis.sock",
          "PING",
        ],
        64
      )
      if (answer === "PONG") return
    } catch {
      // The bounded target may still be loading its AOF.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw failure()
}

const infoFields = (raw) => {
  const fields = new Map()
  for (const line of raw.split(/\r?\n/u)) {
    if (!line || line.startsWith("#")) continue
    const separator = line.indexOf(":")
    if (separator < 1 || fields.has(line.slice(0, separator))) throw failure()
    fields.set(line.slice(0, separator), line.slice(separator + 1))
  }
  return fields
}

const observeTarget = async (runDocker, id, signal) => {
  await waitForRedis(runDocker, id, signal)
  const cli = (args, limit = 4096) =>
    runDocker(
      [
        "exec",
        "--user",
        `${process.getuid()}:${process.getgid()}`,
        id,
        "redis-cli",
        "-s",
        "/socket/redis.sock",
        "--raw",
        ...args,
      ],
      limit
    )
  const server = infoFields(await cli(["INFO", "server"]))
  const persistence = infoFields(await cli(["INFO", "persistence"]))
  const keyspace = infoFields(await cli(["INFO", "keyspace"]))
  const dbsize = await cli(["DBSIZE"], 64)
  if (
    server.get("redis_version") !== "8.10.1" ||
    !/^[a-f0-9]{40}$/u.test(server.get("run_id") ?? "") ||
    persistence.get("aof_enabled") !== "1" ||
    persistence.get("aof_last_write_status") !== "ok" ||
    persistence.get("aof_rewrite_in_progress") !== "0" ||
    !/^(?:0|[1-9]\d*)$/u.test(dbsize)
  )
    throw failure()
  let keyCount = 0
  let expiringKeys = 0
  for (const [name, value] of keyspace) {
    const match = /^db(?:0|[1-9]\d*)$/u.exec(name)
    const data =
      /^keys=(\d+),expires=(\d+),avg_ttl=\d+(?:,subexpiry=\d+)?$/u.exec(value)
    if (!match || !data) throw failure()
    keyCount += Number(data[1])
    expiringKeys += Number(data[2])
  }
  if (
    !Number.isSafeInteger(keyCount) ||
    !Number.isSafeInteger(expiringKeys) ||
    expiringKeys > keyCount ||
    Number(dbsize) > keyCount
  )
    throw failure()
  return {
    runIdSha256: hash(server.get("run_id")),
    keyCount,
    expiringKeys,
    databaseCount: keyspace.size,
  }
}

export const runIsolatedRedisReplay = async ({
  args = process.argv.slice(2),
  environment = process.env,
  runCommand = runRecoveryCommand,
  verify = verifyRedisAofArchive,
  write = (line) => process.stdout.write(line),
  writeError = (line) => process.stderr.write(line),
} = {}) => {
  let phase = "arguments"
  let scope
  let root
  let name
  let token
  let report
  let cleanupFailed = false
  let failureOccurred = false
  try {
    const options = parseReplayArguments(args, environment)
    if (options.mode === "help") {
      write(help)
      return 0
    }
    scope = createRecoveryScope(options.timeoutMs)
    const runDocker = dockerCommand(runCommand, environment, scope.signal)
    phase = "receipt"
    const receiptBytes = await boundedRead(
      options.receiptPath,
      maxReceiptBytes,
      scope.signal
    )
    if (hash(receiptBytes) !== options.receiptSha256) throw failure()
    let receipt
    try {
      receipt = JSON.parse(receiptBytes.toString("utf8"))
    } catch {
      throw failure()
    }
    const directory = await privateDirectory(options.archiveDirectory)
    let files
    try {
      const anchored = `/proc/self/fd/${directory.fd}`
      const manifest = await boundedRead(
        join(anchored, manifestName),
        maxManifestBytes,
        scope.signal
      )
      files = validateCaptureReceipt(receipt, manifest, options.maxBytes)
      const actual = await readdir(anchored)
      if (
        actual.length !== files.length ||
        actual.some((name) => !files.some((file) => file.name === name))
      )
        throw failure()
      phase = "docker_preflight"
      await assertDockerSource(runDocker, options.imageId)
      root = await mkdtemp("/tmp/rr-redis-replay-")
      if (Buffer.byteLength(root) > 160) throw failure()
      const space = await statfs(root, { bigint: true })
      if (
        space.bavail * space.bsize <
        BigInt(receipt.totalBytes * 3 + 16 * 1024 * 1024)
      )
        throw failure()
      const snapshot = join(root, "snapshot")
      const snapshotArchive = join(snapshot, "appendonlydir")
      const data = join(root, "target")
      const targetArchive = join(data, "appendonlydir")
      const socket = join(root, "socket")
      await mkdir(snapshot, { mode: 0o700 })
      await mkdir(snapshotArchive, { mode: 0o700 })
      await mkdir(data, { mode: 0o700 })
      await mkdir(targetArchive, { mode: 0o700 })
      await mkdir(socket, { mode: 0o700 })
      phase = "copy"
      for (const file of files)
        await copyFileBounded(
          join(anchored, file.name),
          join(snapshotArchive, file.name),
          file,
          scope.signal
        )
      phase = "checker"
      const verification = await verify({
        sourceDirectory: snapshotArchive,
        checker,
        checkerSha256,
        maxBytes: options.maxBytes,
        signal: scope.signal,
      })
      const receiptSetSha256 = hash(JSON.stringify(files))
      if (
        verification.status !== "verified" ||
        verification.setSha256 !== receiptSetSha256 ||
        verification.manifestSha256 !== receipt.manifestSha256 ||
        verification.totalBytes !== receipt.totalBytes
      )
        throw failure()
      const snapshotHandle = await privateDirectory(snapshotArchive)
      try {
        for (const file of files)
          await copyFileBounded(
            join(`/proc/self/fd/${snapshotHandle.fd}`, file.name),
            join(targetArchive, file.name),
            file,
            scope.signal
          )
      } finally {
        await snapshotHandle.close()
      }
      phase = "startup"
      token = randomUUID()
      name = `rr-redis-aof-${token}`
      const uid = process.getuid()
      const gid = process.getgid()
      const id = await runDocker(
        [
          "run",
          "--detach",
          "--pull",
          "never",
          "--name",
          name,
          "--label",
          `com.remorseless-records.recovery-run=${token}`,
          "--network",
          "none",
          "--read-only",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges",
          "--cpus",
          "1",
          "--memory",
          "1024m",
          "--memory-swap",
          "1024m",
          "--pids-limit",
          "64",
          "--user",
          `${uid}:${gid}`,
          "--mount",
          `type=bind,source=${data},target=/data`,
          "--mount",
          `type=bind,source=${socket},target=/socket`,
          "--entrypoint",
          "redis-server",
          options.imageId,
          "--port",
          "0",
          "--unixsocket",
          "/socket/redis.sock",
          "--unixsocketperm",
          "700",
          "--dir",
          "/data",
          "--appendonly",
          "yes",
          "--appendfilename",
          "appendonly.aof",
          "--appenddirname",
          "appendonlydir",
          "--appendfsync",
          "always",
          "--auto-aof-rewrite-percentage",
          "0",
          "--aof-load-truncated",
          "no",
          "--save",
          "",
          "--maxmemory",
          "512mb",
          "--maxmemory-policy",
          "noeviction",
        ],
        128
      )
      if (!imageIdPattern.test(`sha256:${id}`)) throw failure()
      const inspect = JSON.parse(await runDocker(["inspect", name], 32 * 1024))
      if (
        !Array.isArray(inspect) ||
        inspect.length !== 1 ||
        inspect[0].Id !== id
      )
        throw failure()
      assertContainer(inspect[0], options.imageId, name, token, data, socket)
      const first = await observeTarget(runDocker, id, scope.signal)
      phase = "restart"
      const restartResult = await runDocker(
        ["restart", "--timeout", "3", id],
        128
      )
      if (restartResult !== id) throw failure()
      const second = await observeTarget(runDocker, id, scope.signal)
      if (
        first.runIdSha256 === second.runIdSha256 ||
        first.keyCount !== second.keyCount ||
        first.expiringKeys !== second.expiringKeys ||
        first.databaseCount !== second.databaseCount
      )
        throw failure()
      report = {
        schemaVersion: 1,
        event: "redis.aof_isolated_replay.completed",
        receiptSha256: options.receiptSha256,
        sourceFingerprint: receipt.sourceFingerprint,
        manifestSha256: receipt.manifestSha256,
        setSha256: verification.setSha256,
        checkerSha256: redisCheckerBinarySha256,
        targetImageId: options.imageId,
        fileCount: files.length,
        copiedBytes: receipt.totalBytes,
        keyCount: second.keyCount,
        expiringKeys: second.expiringKeys,
        databaseCount: second.databaseCount,
        startupProven: true,
        restartProven: true,
        queueReconciled: false,
        businessReconciled: false,
      }
    } finally {
      await directory.close()
    }
  } catch {
    failureOccurred = true
  } finally {
    if (name && token) {
      const cleanup = dockerCommand(
        runCommand,
        environment,
        AbortSignal.timeout(15_000)
      )
      try {
        const labels = await cleanup(
          [
            "inspect",
            "--format",
            '{{index .Config.Labels "com.remorseless-records.recovery-run"}}',
            name,
          ],
          128
        )
        if (labels === token) await cleanup(["rm", "--force", name], 128)
        else cleanupFailed = true
      } catch {
        try {
          const remaining = await cleanup(
            [
              "ps",
              "--all",
              "--filter",
              `name=^/${name}$`,
              "--format",
              "{{.ID}}",
            ],
            128
          )
          if (remaining) cleanupFailed = true
        } catch {
          cleanupFailed = true
        }
      }
    }
    if (
      !cleanupFailed &&
      root &&
      basename(root).startsWith("rr-redis-replay-")
    ) {
      try {
        await rm(root, { recursive: true, force: true })
      } catch {
        cleanupFailed = true
      }
    }
    scope?.close()
  }
  if (cleanupFailed) {
    writeError(
      `${JSON.stringify({ schemaVersion: 1, event: "redis.aof_isolated_replay.cleanup_unverified" })}\n`
    )
    return 1
  }
  if (failureOccurred || !report) {
    writeError(
      `${JSON.stringify({ schemaVersion: 1, event: "redis.aof_isolated_replay.failed", phase })}\n`
    )
    return 1
  }
  write(`${JSON.stringify(report)}\n`)
  return 0
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.exitCode = await runIsolatedRedisReplay()
