import { spawn } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
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
  statfs,
} from "node:fs/promises"
import { basename, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseAofManifest } from "./lib/redis-aof-recovery.mjs"

const remoteProgram = fileURLToPath(
  new URL("./lib/redis-aof-capture-remote.pl", import.meta.url)
)
const manifestName = "appendonly.aof.manifest"
const defaultMaxBytes = 512 * 1024 * 1024
const maxMaxBytes = 10 * 1024 ** 3
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u
const sha256Pattern = /^[a-f0-9]{64}$/u
const scopeFlags = [
  "--project-id",
  "--environment-id",
  "--service-id",
  "--deployment-id",
  "--instance-id",
  "--volume-id",
  "--volume-instance-id",
]
const help = `Usage: node scripts/redis-aof-capture.mjs <preflight|capture> \\
  --project-id <uuid> --environment-id <uuid> --service-id <uuid> \\
  --deployment-id <uuid> --instance-id <uuid> --volume-id <uuid> \\
  --volume-instance-id <uuid> [--max-bytes <decimal>] [--deadline-seconds <decimal>]
capture also requires --output-parent <private-0700-directory> --confirm <preflight-fingerprint>.

Preflight uses Railway metadata and read-only commands in the pinned Redis instance.
Capture temporarily sets auto-aof-rewrite-percentage to 0, streams only manifest-
listed files to a local private directory, restores the original setting, and
independently rechecks it. Capture changes live Redis configuration and requires
separate operational approval. Never run it during a deployment or manual rewrite.
The resulting archive still needs the offline checker, isolated startup replay,
and queue/business reconciliation. No source-volume file is written.
`

const failure = () => new Error("Redis AOF capture unavailable.")
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex")

const positiveInteger = (value, maximum) => {
  if (!/^[1-9]\d*$/u.test(value ?? "")) throw failure()
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number > maximum) throw failure()
  return number
}

export const parseCaptureArguments = (args) => {
  const normalized = args[0] === "--" ? args.slice(1) : args
  if (normalized.length === 1 && normalized[0] === "--help")
    return { mode: "help" }
  const [mode, ...rest] = normalized
  if (mode !== "preflight" && mode !== "capture") throw failure()
  const allowed = new Set([
    ...scopeFlags,
    "--max-bytes",
    "--deadline-seconds",
    ...(mode === "capture" ? ["--output-parent", "--confirm"] : []),
  ])
  if (rest.length % 2 !== 0) throw failure()
  const options = new Map()
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index]
    const value = rest[index + 1]
    if (
      !allowed.has(key) ||
      options.has(key) ||
      !value ||
      value.startsWith("--")
    )
      throw failure()
    options.set(key, value)
  }
  const scope = {
    projectId: options.get("--project-id"),
    environmentId: options.get("--environment-id"),
    serviceId: options.get("--service-id"),
    deploymentId: options.get("--deployment-id"),
    instanceId: options.get("--instance-id"),
    volumeId: options.get("--volume-id"),
    volumeInstanceId: options.get("--volume-instance-id"),
    mountPath: "/bitnami",
  }
  if (
    Object.values(scope)
      .slice(0, -1)
      .some((value) => !uuid.test(value ?? ""))
  )
    throw failure()
  const maxBytes = options.has("--max-bytes")
    ? positiveInteger(options.get("--max-bytes"), maxMaxBytes)
    : defaultMaxBytes
  const deadlineSeconds = options.has("--deadline-seconds")
    ? positiveInteger(options.get("--deadline-seconds"), 600)
    : 300
  if (deadlineSeconds < 30) throw failure()
  if (mode === "capture") {
    if (!sha256Pattern.test(options.get("--confirm") ?? "")) throw failure()
    const parent = options.get("--output-parent")
    if (!parent || !isAbsolute(parent) || resolve(parent) !== parent)
      throw failure()
    return {
      mode,
      scope,
      maxBytes,
      deadlineSeconds,
      outputParent: parent,
      confirm: options.get("--confirm"),
    }
  }
  return { mode, scope, maxBytes, deadlineSeconds }
}

export const assertRailwaySource = (status, scope) => {
  if (status?.id !== scope.projectId) throw failure()
  const environments = status.environments?.edges?.map(({ node }) => node) ?? []
  const environment = environments.find(({ id }) => id === scope.environmentId)
  if (!environment || environment.name !== "staging") throw failure()
  const instances =
    environment.serviceInstances?.edges?.map(({ node }) => node) ?? []
  const service = instances.find(
    ({ serviceId }) => serviceId === scope.serviceId
  )
  if (!service || service.serviceName !== "Redis") throw failure()
  const deployments = service.activeDeployments ?? []
  if (
    deployments.length !== 1 ||
    deployments[0].id !== scope.deploymentId ||
    deployments[0].instances?.length !== 1 ||
    deployments[0].instances[0].id !== scope.instanceId ||
    deployments[0].instances[0].status !== "RUNNING"
  )
    throw failure()
  const volumes =
    environment.volumeInstances?.edges?.map(({ node }) => node) ?? []
  const volume = volumes.find(({ id }) => id === scope.volumeInstanceId)
  if (
    !volume ||
    volume.serviceId !== scope.serviceId ||
    volume.environmentId !== scope.environmentId ||
    volume.volume?.id !== scope.volumeId ||
    volume.mountPath !== scope.mountPath ||
    volume.state !== "READY" ||
    volume.isPendingDeletion !== false
  )
    throw failure()
  return { deployment: deployments[0], volume }
}

const runTextCommand = async (
  command,
  args,
  timeoutMs,
  maxBytes = 1024 * 1024
) => {
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, LC_ALL: "C" },
  })
  let output = ""
  let exceeded = false
  let expired = false
  child.stderr.resume()
  const closed = new Promise((resolveCode, reject) => {
    child.once("error", reject)
    child.once("close", resolveCode)
  })
  const timer = setTimeout(() => {
    expired = true
    child.kill("SIGTERM")
  }, timeoutMs)
  const killTimer = setTimeout(() => child.kill("SIGKILL"), timeoutMs + 2_000)
  try {
    for await (const chunk of child.stdout) {
      output += chunk
      if (Buffer.byteLength(output) > maxBytes) {
        exceeded = true
        child.kill("SIGTERM")
        break
      }
    }
    if ((await closed) !== 0 || exceeded || expired) throw failure()
    return output
  } catch {
    throw failure()
  } finally {
    clearTimeout(timer)
    clearTimeout(killTimer)
  }
}

export const readRailwayStatus = async (
  scope,
  { command = "railway" } = {}
) => {
  const raw = await runTextCommand(
    command,
    ["status", "-p", scope.projectId, "-e", scope.environmentId, "--json"],
    15_000
  )
  try {
    return JSON.parse(raw)
  } catch {
    throw failure()
  }
}

const boundedBase64 = (encoded, maxBytes) => {
  if (
    typeof encoded !== "string" ||
    encoded.length > Math.ceil(maxBytes / 3) * 4 + 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      encoded
    )
  )
    throw failure()
  const bytes = Buffer.from(encoded, "base64")
  if (bytes.length > maxBytes || bytes.toString("base64") !== encoded)
    throw failure()
  return bytes
}

export const validatePreflight = (event, scope, maxBytes) => {
  if (
    event?.type !== "preflight" ||
    !sha256Pattern.test(event.runIdSha256 ?? "") ||
    !sha256Pattern.test(event.manifestSha256 ?? "") ||
    event.aofDir !== join(scope.mountPath, "redis/data/appendonlydir") ||
    !/^(?:0|[1-9]\d{0,4})$/u.test(event.autoRewritePercentage ?? "")
  )
    throw failure()
  const manifest = boundedBase64(event.manifestBase64, 16 * 1024)
  if (hash(manifest) !== event.manifestSha256) throw failure()
  const entries = parseAofManifest(
    new TextDecoder("utf-8", { fatal: true }).decode(manifest)
  )
  const names = [manifestName, ...entries.map(({ name }) => name)]
  if (
    !Array.isArray(event.files) ||
    event.files.length !== names.length ||
    !Number.isSafeInteger(event.totalBytes) ||
    event.totalBytes > maxBytes
  )
    throw failure()
  let total = 0
  for (let index = 0; index < names.length; index += 1) {
    const file = event.files[index]
    if (
      file?.name !== names[index] ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0
    )
      throw failure()
    total += file.bytes
  }
  if (total !== event.totalBytes) throw failure()
  const fingerprint = hash(
    JSON.stringify({
      scope,
      runIdSha256: event.runIdSha256,
      manifestSha256: event.manifestSha256,
      autoRewritePercentage: event.autoRewritePercentage,
    })
  )
  return {
    fingerprint,
    runIdSha256: event.runIdSha256,
    manifestSha256: event.manifestSha256,
    priorRewritePercentage: event.autoRewritePercentage,
    files: names,
    activeFileCount: entries.filter(({ type }) => type !== "h").length,
    historyFileCount: entries.filter(({ type }) => type === "h").length,
    totalBytes: total,
  }
}

const readPrivateParent = async (path) => {
  if (Buffer.byteLength(path) > 1024) throw failure()
  const details = await lstat(path, { bigint: true })
  if (
    !details.isDirectory() ||
    details.isSymbolicLink() ||
    (details.mode & 0o077n) !== 0n ||
    (process.getuid && details.uid !== BigInt(process.getuid())) ||
    (await realpath(path)) !== path
  )
    throw failure()
  return { dev: details.dev, ino: details.ino }
}

export const createCaptureConsumer = (archive, preflight, maxBytes) => {
  const files = []
  let phase = "start"
  let current
  let totalBytes = 0
  const push = async (event) => {
    if (phase === "start") {
      if (
        event?.type !== "start" ||
        event.manifestSha256 !== preflight.manifestSha256 ||
        event.runIdSha256 !== preflight.runIdSha256 ||
        event.priorRewritePercentage !== preflight.priorRewritePercentage
      )
        throw failure()
      phase = "files"
      return
    }
    if (event?.type === "failed") throw failure()
    if (event?.type === "fileStart") {
      if (
        current ||
        event.name !== preflight.files[files.length] ||
        !Number.isSafeInteger(event.bytes) ||
        event.bytes < 0 ||
        totalBytes + event.bytes > maxBytes
      )
        throw failure()
      const handle = await open(
        join(archive, event.name),
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600
      )
      current = {
        name: event.name,
        bytes: event.bytes,
        offset: 0,
        hash: createHash("sha256"),
        handle,
      }
      return
    }
    if (event?.type === "chunk") {
      if (
        !current ||
        event.name !== current.name ||
        event.offset !== current.offset
      )
        throw failure()
      const bytes = boundedBase64(event.data, 32768)
      if (bytes.length === 0 || current.offset + bytes.length > current.bytes)
        throw failure()
      let written = 0
      while (written < bytes.length) {
        const result = await current.handle.write(
          bytes,
          written,
          bytes.length - written
        )
        if (result.bytesWritten <= 0) throw failure()
        written += result.bytesWritten
      }
      current.hash.update(bytes)
      current.offset += bytes.length
      return
    }
    if (event?.type === "fileEnd") {
      if (
        !current ||
        event.name !== current.name ||
        event.bytes !== current.bytes ||
        current.offset !== current.bytes ||
        !sha256Pattern.test(event.sha256 ?? "")
      )
        throw failure()
      const digest = current.hash.digest("hex")
      if (digest !== event.sha256) throw failure()
      await current.handle.sync()
      await current.handle.close()
      files.push({ name: current.name, bytes: current.bytes, sha256: digest })
      totalBytes += current.bytes
      current = undefined
      return
    }
    if (event?.type === "done") {
      if (
        current ||
        files.length !== preflight.files.length ||
        event.manifestSha256 !== preflight.manifestSha256 ||
        event.runIdSha256 !== preflight.runIdSha256 ||
        event.priorRewritePercentage !== preflight.priorRewritePercentage ||
        event.rewriteRestored !== true ||
        files[0]?.sha256 !== preflight.manifestSha256
      )
        throw failure()
      phase = "done"
      return
    }
    throw failure()
  }
  const finish = () => {
    if (phase !== "done") throw failure()
    return { files, totalBytes }
  }
  const close = async () => {
    await current?.handle.close()
  }
  return { push, finish, close }
}

export const consumeCaptureEvents = async (
  events,
  archive,
  preflight,
  maxBytes
) => {
  const consumer = createCaptureConsumer(archive, preflight, maxBytes)
  try {
    for await (const event of events) await consumer.push(event)
    return consumer.finish()
  } finally {
    await consumer.close()
  }
}

export const runRailwayRemote = async (
  scope,
  request,
  { timeoutMs = 30_000, onEvent, command = "railway" } = {}
) => {
  const code = await readFile(remoteProgram)
  const encoded = Buffer.from(
    JSON.stringify({ ...scope, ...request })
  ).toString("base64")
  const args = [
    "ssh",
    "-p",
    scope.projectId,
    "-s",
    scope.serviceId,
    "-e",
    scope.environmentId,
    "-d",
    scope.instanceId,
    "--",
    "perl",
    "-",
    encoded,
  ]
  const child = spawn(command, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, LC_ALL: "C" },
  })
  child.stderr.resume()
  child.stdin.on("error", () => {})
  child.stdin.end(code)
  const closed = new Promise((resolveCode, reject) => {
    child.once("error", reject)
    child.once("close", resolveCode)
  })
  let expired = false
  const timer = setTimeout(() => {
    expired = true
    child.kill("SIGTERM")
  }, timeoutMs)
  const killTimer = setTimeout(() => child.kill("SIGKILL"), timeoutMs + 2_000)
  const seen = []
  let wireBytes = 0
  let pending = Buffer.alloc(0)
  try {
    for await (const chunk of child.stdout) {
      wireBytes += chunk.length
      if (wireBytes > (request.maxBytes ?? 0) * 2 + 256 * 1024) throw failure()
      let bytes = Buffer.concat([pending, chunk])
      let newline = bytes.indexOf(10)
      while (newline !== -1) {
        if (newline > 48 * 1024) throw failure()
        let event
        try {
          event = JSON.parse(bytes.subarray(0, newline).toString("utf8"))
        } catch {
          throw failure()
        }
        if (onEvent) await onEvent(event)
        else {
          if (seen.length >= 1) throw failure()
          seen.push(event)
        }
        bytes = bytes.subarray(newline + 1)
        newline = bytes.indexOf(10)
      }
      if (bytes.length > 48 * 1024) throw failure()
      pending = Buffer.from(bytes)
    }
    if (pending.length !== 0) throw failure()
    if ((await closed) !== 0 || expired) throw failure()
    if (!onEvent && seen.length !== 1) throw failure()
    return seen[0]
  } catch {
    child.kill("SIGTERM")
    const force = setTimeout(() => child.kill("SIGKILL"), 2_000)
    await Promise.race([
      closed.catch(() => undefined),
      new Promise((resolveWait) => setTimeout(resolveWait, 3_000)),
    ])
    clearTimeout(force)
    throw failure()
  } finally {
    clearTimeout(timer)
    clearTimeout(killTimer)
  }
}

const collectRemote = async (scope, request, timeoutMs) =>
  runRailwayRemote(scope, request, { timeoutMs })

export const runCaptureCli = async ({
  args = process.argv.slice(2),
  status = readRailwayStatus,
  remote = collectRemote,
  captureRemote = runRailwayRemote,
  postcheckAttempts = 10,
  postcheckWaitMs = 1000,
  write = (line) => process.stdout.write(line),
  writeError = (line) => process.stderr.write(line),
} = {}) => {
  let phase = "arguments"
  let temporaryDirectory
  let ownedFinalDirectory
  let parentHandle
  let restoreVerified = false
  let liveConfigChangeAttempted = false
  try {
    const options = parseCaptureArguments(args)
    if (options.mode === "help") {
      write(help)
      return 0
    }
    phase = "source_identity"
    assertRailwaySource(await status(options.scope), options.scope)
    phase = "preflight"
    const event = await remote(
      options.scope,
      { mode: "preflight", maxBytes: options.maxBytes },
      30_000
    )
    const preflight = validatePreflight(event, options.scope, options.maxBytes)
    if (options.mode === "preflight") {
      write(
        `${JSON.stringify({
          schemaVersion: 1,
          event: "redis.aof_capture.preflight",
          source: options.scope,
          fingerprint: preflight.fingerprint,
          manifestSha256: preflight.manifestSha256,
          activeFileCount: preflight.activeFileCount,
          historyFileCount: preflight.historyFileCount,
          totalBytes: preflight.totalBytes,
          priorRewritePercentage: preflight.priorRewritePercentage,
          liveConfigChanged: false,
        })}\n`
      )
      return 0
    }
    if (options.confirm !== preflight.fingerprint) throw failure()
    const parentIdentity = await readPrivateParent(options.outputParent)
    parentHandle = await open(
      options.outputParent,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    )
    const openedParent = await parentHandle.stat({ bigint: true })
    if (
      openedParent.dev !== parentIdentity.dev ||
      openedParent.ino !== parentIdentity.ino
    )
      throw failure()
    const anchoredParent = `/proc/self/fd/${parentHandle.fd}`
    const filesystem = await statfs(anchoredParent, { bigint: true })
    if (
      filesystem.bavail * filesystem.bsize <
      BigInt(options.maxBytes + 16 * 1024 * 1024)
    )
      throw failure()
    temporaryDirectory = await mkdtemp(
      join(anchoredParent, ".redis-aof-partial-")
    )
    const archive = join(temporaryDirectory, "appendonlydir")
    await mkdir(archive, { mode: 0o700 })
    phase = "capture"
    let captured
    let captureError
    try {
      const consumer = createCaptureConsumer(
        archive,
        preflight,
        options.maxBytes
      )
      try {
        liveConfigChangeAttempted = true
        await captureRemote(
          options.scope,
          {
            mode: "capture",
            maxBytes: options.maxBytes,
            deadlineSeconds: options.deadlineSeconds,
            manifestSha256: preflight.manifestSha256,
            runIdSha256: preflight.runIdSha256,
            priorRewritePercentage: preflight.priorRewritePercentage,
            files: preflight.files,
          },
          {
            timeoutMs: (options.deadlineSeconds + 20) * 1000,
            onEvent: consumer.push,
          }
        )
        captured = consumer.finish()
      } finally {
        await consumer.close()
      }
    } catch (error) {
      captureError = error
    }
    phase = "restore_check"
    for (let attempt = 0; attempt < postcheckAttempts; attempt += 1) {
      try {
        const check = await remote(
          options.scope,
          {
            mode: "postcheck",
            runIdSha256: preflight.runIdSha256,
            priorRewritePercentage: preflight.priorRewritePercentage,
            maxBytes: 1,
          },
          15_000
        )
        if (
          check?.type === "postcheck" &&
          check.runIdSha256 === preflight.runIdSha256 &&
          check.autoRewritePercentage === preflight.priorRewritePercentage
        ) {
          restoreVerified = true
          break
        }
      } catch {
        // The remote watchdog may still be restoring after a dropped SSH stream.
      }
      if (attempt + 1 < postcheckAttempts)
        await new Promise((resolveDelay) =>
          setTimeout(resolveDelay, postcheckWaitMs)
        )
    }
    if (captureError || !restoreVerified || !captured) throw failure()
    phase = "publication"
    assertRailwaySource(await status(options.scope), options.scope)
    const currentParent = await readPrivateParent(options.outputParent)
    if (
      currentParent.dev !== parentIdentity.dev ||
      currentParent.ino !== parentIdentity.ino
    )
      throw failure()
    const receipt = {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      source: options.scope,
      sourceFingerprint: preflight.fingerprint,
      runIdSha256: preflight.runIdSha256,
      manifestSha256: preflight.manifestSha256,
      files: captured.files,
      totalBytes: captured.totalBytes,
      priorRewritePercentage: preflight.priorRewritePercentage,
      rewriteRestored: true,
      checkerVerified: false,
      replayProven: false,
      queueReconciled: false,
    }
    const receiptHandle = await open(
      join(temporaryDirectory, "capture.receipt.json"),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600
    )
    try {
      await receiptHandle.writeFile(`${JSON.stringify(receipt)}\n`)
      await receiptHandle.sync()
    } finally {
      await receiptHandle.close()
    }
    const finalName = `redis-aof-capture-${randomUUID()}`
    const destination = join(anchoredParent, finalName)
    await rename(temporaryDirectory, destination)
    temporaryDirectory = undefined
    ownedFinalDirectory = destination
    const publishedParent = await readPrivateParent(options.outputParent)
    if (
      publishedParent.dev !== parentIdentity.dev ||
      publishedParent.ino !== parentIdentity.ino
    )
      throw failure()
    const finalDirectory = join(options.outputParent, finalName)
    write(
      `${JSON.stringify({
        schemaVersion: 1,
        event: "redis.aof_capture.completed",
        archiveDirectory: join(finalDirectory, "appendonlydir"),
        receipt: join(finalDirectory, "capture.receipt.json"),
        manifestSha256: receipt.manifestSha256,
        fileCount: receipt.files.length,
        totalBytes: receipt.totalBytes,
        rewriteRestored: true,
        checkerVerified: false,
        replayProven: false,
      })}\n`
    )
    ownedFinalDirectory = undefined
    return 0
  } catch {
    writeError(
      `${JSON.stringify({
        schemaVersion: 1,
        event: "redis.aof_capture.failed",
        phase,
        liveConfigChangeAttempted,
        restoreVerified,
      })}\n`
    )
    return 1
  } finally {
    let cleanupFailed = false
    try {
      if (
        temporaryDirectory &&
        basename(temporaryDirectory).startsWith(".redis-aof-partial-")
      )
        await rm(temporaryDirectory, { recursive: true, force: true })
    } catch {
      cleanupFailed = true
    }
    try {
      if (
        ownedFinalDirectory &&
        basename(ownedFinalDirectory).startsWith("redis-aof-capture-")
      )
        await rm(ownedFinalDirectory, { recursive: true, force: true })
    } catch {
      cleanupFailed = true
    }
    try {
      await parentHandle?.close()
    } catch {
      cleanupFailed = true
    }
    if (cleanupFailed)
      writeError(
        `${JSON.stringify({ schemaVersion: 1, event: "redis.aof_capture.cleanup_unverified" })}\n`
      )
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.exitCode = await runCaptureCli()
