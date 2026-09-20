import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { assertRailwaySource, readRailwayStatus } from "./redis-aof-capture.mjs"

const remoteProgram = fileURLToPath(
  new URL("./lib/redis-live-aggregate-remote.pl", import.meta.url)
)
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u
const sha256 = /^[a-f0-9]{64}$/u
const scopeFlags = [
  ["--project-id", "projectId"],
  ["--environment-id", "environmentId"],
  ["--service-id", "serviceId"],
  ["--deployment-id", "deploymentId"],
  ["--instance-id", "instanceId"],
  ["--volume-id", "volumeId"],
  ["--volume-instance-id", "volumeInstanceId"],
]
const queueNames = ["eventBus", "workflows", "scheduledJobs", "cleaner"]
const categoryNames = [
  ...queueNames,
  "medusaLocks",
  "workflowCheckpointLocks",
  "workflowCheckpoints",
  "cartIdempotencyLocks",
  "cartIdempotencyResults",
  "healthSnapshots",
  "rateLimits",
  "other",
]
const typeNames = ["string", "list", "set", "zset", "hash", "stream", "other"]
const ttlNames = [
  "persistent",
  "under30Seconds",
  "under10Minutes",
  "over10Minutes",
  "vanishedDuringScan",
]
const stateNames = [
  "wait",
  "active",
  "paused",
  "delayed",
  "prioritized",
  "completed",
  "failed",
  "waiting-children",
  "repeat",
  "stalled",
  "events",
  "meta",
]
const help = `Usage: pnpm run data:redis:live-aggregate -- \\
  --project-id <uuid> --environment-id <uuid> --service-id <uuid> \\
  --deployment-id <uuid> --instance-id <uuid> --volume-id <uuid> \\
  --volume-instance-id <uuid> --expected-run-id-sha256 <sha256>

Read-only, bounded staging Redis queue aggregate. Use the seven IDs from a fresh
AOF preflight and the Redis run-ID SHA from the private capture receipt. The
source and its AOF health are checked inside the pinned container before and
after a capped scan; Railway identity is
checked on both sides. Only fixed category, type, TTL and queue-state counts
leave the container. This diagnostic is not queue or business reconciliation.
`
const failure = () => new Error("Live Redis aggregate unavailable.")
const keysExactly = (value, expected) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join("\0") === [...expected].sort().join("\0")
const count = (value, maximum) =>
  Number.isSafeInteger(value) && value >= 0 && value <= maximum
const signalOwnedGroup = (child, signal) => {
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0) return false
  try {
    if (process.platform === "win32") child.kill(signal)
    else process.kill(-child.pid, signal)
    return true
  } catch (error) {
    return error?.code === "ESRCH"
  }
}
const waitForClose = (closed, timeoutMs) =>
  new Promise((resolveWait) => {
    const timer = setTimeout(() => resolveWait(false), timeoutMs)
    closed.then(() => {
      clearTimeout(timer)
      resolveWait(true)
    })
  })

export const parseLiveAggregateArguments = (args) => {
  const normalized = args[0] === "--" ? args.slice(1) : args
  if (normalized.length === 1 && normalized[0] === "--help")
    return { mode: "help" }
  if (normalized.length !== (scopeFlags.length + 1) * 2) throw failure()
  const values = new Map()
  for (let index = 0; index < normalized.length; index += 2) {
    const flag = normalized[index]
    const value = normalized[index + 1]
    if (
      ![
        ...scopeFlags.map(([name]) => name),
        "--expected-run-id-sha256",
      ].includes(flag) ||
      values.has(flag) ||
      typeof value !== "string" ||
      value.startsWith("--")
    )
      throw failure()
    values.set(flag, value)
  }
  const scope = Object.fromEntries(
    scopeFlags.map(([flag, name]) => [name, values.get(flag)])
  )
  if (Object.values(scope).some((value) => !uuid.test(value ?? "")))
    throw failure()
  const runIdSha256 = values.get("--expected-run-id-sha256")
  if (!sha256.test(runIdSha256 ?? "")) throw failure()
  return {
    mode: "aggregate",
    scope: { ...scope, mountPath: "/bitnami" },
    runIdSha256,
  }
}

export const validateLiveAggregate = (aggregate) => {
  if (
    !keysExactly(aggregate, [
      "schemaVersion",
      "scannedKeys",
      "categories",
      "queues",
    ]) ||
    aggregate.schemaVersion !== 1 ||
    !count(aggregate.scannedKeys, 5_000) ||
    !keysExactly(aggregate.categories, categoryNames) ||
    !keysExactly(aggregate.queues, queueNames)
  )
    throw failure()
  let total = 0
  let vanished = 0
  for (const name of categoryNames) {
    const category = aggregate.categories[name]
    if (
      !keysExactly(category, ["count", "types", "ttl"]) ||
      !count(category.count, aggregate.scannedKeys) ||
      !keysExactly(category.types, typeNames) ||
      !keysExactly(category.ttl, ttlNames)
    )
      throw failure()
    if (
      typeNames.some(
        (type) => !count(category.types[type], aggregate.scannedKeys)
      ) ||
      ttlNames.some(
        (ttl) => !count(category.ttl[ttl], aggregate.scannedKeys)
      ) ||
      typeNames.reduce((sum, type) => sum + category.types[type], 0) !==
        category.count ||
      ttlNames.reduce((sum, ttl) => sum + category.ttl[ttl], 0) !==
        category.count + category.ttl.vanishedDuringScan
    )
      throw failure()
    total += category.count
    vanished += category.ttl.vanishedDuringScan
  }
  if (total + vanished !== aggregate.scannedKeys) throw failure()
  for (const name of queueNames) {
    const queue = aggregate.queues[name]
    if (
      !keysExactly(queue, ["keyCount", "states"]) ||
      queue.keyCount !== aggregate.categories[name].count ||
      !keysExactly(queue.states, stateNames) ||
      stateNames.some((state) => !count(queue.states[state], 1_000_000_000))
    )
      throw failure()
  }
  return aggregate
}

export const runLiveAggregateRemote = async (
  scope,
  runIdSha256,
  { command = "railway" } = {}
) => {
  const code = await readFile(remoteProgram)
  const encoded = Buffer.from(
    JSON.stringify({ ...scope, mode: "aggregate", runIdSha256 })
  ).toString("base64")
  const child = spawn(
    command,
    [
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
    ],
    {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, LC_ALL: "C" },
      detached: process.platform !== "win32",
    }
  )
  child.stderr.resume()
  child.stdin.on("error", () => undefined)
  child.stdin.end(code)
  const closed = new Promise((resolveClosed) => {
    child.once("error", () => resolveClosed(null))
    child.once("close", resolveClosed)
  })
  let expired = false
  const timer = setTimeout(() => {
    expired = true
    signalOwnedGroup(child, "SIGTERM")
  }, 30_000)
  const force = setTimeout(() => {
    if (expired) signalOwnedGroup(child, "SIGKILL")
  }, 32_000)
  let output = ""
  try {
    for await (const chunk of child.stdout) {
      output += chunk
      if (Buffer.byteLength(output) > 16 * 1024) throw failure()
    }
    if (
      (await closed) !== 0 ||
      expired ||
      !output.endsWith("\n") ||
      output.indexOf("\n") !== output.length - 1
    )
      throw failure()
    return validateLiveAggregate(JSON.parse(output))
  } catch {
    signalOwnedGroup(child, "SIGTERM")
    const exited = await waitForClose(closed, 2_000)
    // The CLI can exit while an SSH descendant remains in its process group.
    signalOwnedGroup(child, "SIGKILL")
    if (!exited) await waitForClose(closed, 3_000)
    throw failure()
  } finally {
    clearTimeout(timer)
    clearTimeout(force)
  }
}

export const runLiveAggregateCli = async ({
  args = process.argv.slice(2),
  status = readRailwayStatus,
  remote = runLiveAggregateRemote,
  write = (line) => process.stdout.write(line),
  writeError = (line) => process.stderr.write(line),
} = {}) => {
  try {
    const options = parseLiveAggregateArguments(args)
    if (options.mode === "help") {
      write(help)
      return 0
    }
    const observedAtStart = new Date().toISOString()
    assertRailwaySource(await status(options.scope), options.scope)
    const aggregate = validateLiveAggregate(
      await remote(options.scope, options.runIdSha256)
    )
    assertRailwaySource(await status(options.scope), options.scope)
    const observedAtEnd = new Date().toISOString()
    const elapsed = Date.parse(observedAtEnd) - Date.parse(observedAtStart)
    if (elapsed < 0 || elapsed > 65_000) throw failure()
    write(
      `${JSON.stringify({
        event: "redis.live_queue_aggregate.completed",
        ...aggregate,
        observedAtStart,
        observedAtEnd,
        sourceIdentityVerified: true,
        readOnly: true,
        queueReconciled: false,
        businessReconciled: false,
      })}\n`
    )
    return 0
  } catch {
    writeError(
      `${JSON.stringify({
        schemaVersion: 1,
        event: "redis.live_queue_aggregate.failed",
        reason: "aggregate_unavailable",
      })}\n`
    )
    return 1
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.exitCode = await runLiveAggregateCli()
