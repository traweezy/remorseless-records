import { lstat, realpath } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { classifyIsolatedFailedJobs } from "./redis-failed-job-classifier.mjs"

const requireBackend = createRequire(
  new URL("../../backend/package.json", import.meta.url)
)
const { createClient } = requireBackend("redis")

const failure = () => new Error("Redis recovery aggregate unavailable.")
const queueDefinitions = Object.freeze([
  ["eventBus", "RedisEventBusService:events-queue"],
  ["workflows", "bull:medusa-workflows"],
  ["scheduledJobs", "bull:medusa-workflows-jobs"],
  ["cleaner", "bull:workflows-cleaner"],
])
const stateDefinitions = Object.freeze([
  ["wait", "list", "lLen"],
  ["active", "list", "lLen"],
  ["paused", "list", "lLen"],
  ["delayed", "zset", "zCard"],
  ["prioritized", "zset", "zCard"],
  ["completed", "zset", "zCard"],
  ["failed", "zset", "zCard"],
  ["waiting-children", "zset", "zCard"],
  ["repeat", "zset", "zCard"],
  ["stalled", "set", "sCard"],
  ["events", "stream", "xLen"],
  ["meta", "hash", "hLen"],
])
const categoryNames = Object.freeze([
  ...queueDefinitions.map(([name]) => name),
  "medusaLocks",
  "workflowCheckpointLocks",
  "workflowCheckpoints",
  "cartIdempotencyLocks",
  "cartIdempotencyResults",
  "healthSnapshots",
  "rateLimits",
  "other",
])
const typeNames = Object.freeze([
  "string",
  "list",
  "set",
  "zset",
  "hash",
  "stream",
  "other",
])
const ttlNames = Object.freeze([
  "persistent",
  "under30Seconds",
  "under10Minutes",
  "over10Minutes",
  "vanishedDuringScan",
])
const integer = (value) => {
  if (!Number.isSafeInteger(value) || value < 0) throw failure()
  return value
}

const blankCounts = (names) =>
  Object.fromEntries(names.map((name) => [name, 0]))

const categoryFor = (key) => {
  for (const [name, prefix] of queueDefinitions)
    if (key.startsWith(`${prefix}:`)) return name
  if (key.startsWith("medusa_lock:")) return "medusaLocks"
  if (key.startsWith("dtrx:"))
    return key.endsWith(":lock")
      ? "workflowCheckpointLocks"
      : "workflowCheckpoints"
  if (key.startsWith("rr:cart:idempotency:v1:"))
    return key.endsWith(":lock")
      ? "cartIdempotencyLocks"
      : "cartIdempotencyResults"
  if (key.startsWith("rr:health:")) return "healthSnapshots"
  if (key.startsWith("rr:rate:v1:")) return "rateLimits"
  return "other"
}

const expectedString = new Set([
  "medusaLocks",
  "workflowCheckpointLocks",
  "workflowCheckpoints",
  "cartIdempotencyLocks",
  "cartIdempotencyResults",
  "healthSnapshots",
  "rateLimits",
])

const ttlBucket = (ttl) => {
  if (ttl === -2) return "vanishedDuringScan"
  if (ttl === -1) return "persistent"
  if (!Number.isSafeInteger(ttl) || ttl < 0) throw failure()
  if (ttl < 30_000) return "under30Seconds"
  if (ttl < 600_000) return "under10Minutes"
  return "over10Minutes"
}

const collectRedisQueueAggregateInner = async ({
  client,
  signal,
  maxKeys = 5_000,
  timeoutMs = 15_000,
  clock = Date.now,
}) => {
  if (
    !client ||
    !Number.isSafeInteger(maxKeys) ||
    maxKeys < 1 ||
    maxKeys > 20_000 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 60_000
  )
    throw failure()
  const deadline = clock() + timeoutMs
  const run = async (operation) => {
    signal?.throwIfAborted()
    const remaining = deadline - clock()
    if (!Number.isFinite(remaining) || remaining <= 0) throw failure()
    let timer
    let onAbort
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(failure()), remaining)
        }),
        ...(signal
          ? [
              new Promise((_, reject) => {
                onAbort = () => reject(failure())
                signal.addEventListener("abort", onAbort, { once: true })
              }),
            ]
          : []),
      ])
    } finally {
      clearTimeout(timer)
      if (onAbort) signal.removeEventListener("abort", onAbort)
    }
  }

  const keys = new Set()
  const cursors = new Set()
  let cursor = "0"
  let scannedBytes = 0
  let iterations = 0
  do {
    if (iterations++ >= 256 || cursors.has(cursor)) throw failure()
    cursors.add(cursor)
    const reply = await run(() => client.scan(cursor, { COUNT: 128 }))
    const next = String(reply?.cursor ?? "")
    if (
      !/^(?:0|[1-9][0-9]{0,19})$/u.test(next) ||
      BigInt(next) > 18_446_744_073_709_551_615n ||
      !Array.isArray(reply?.keys) ||
      reply.keys.length > 512
    )
      throw failure()
    for (const key of reply.keys) {
      if (
        typeof key !== "string" ||
        key.length === 0 ||
        key.includes("\0") ||
        key.includes("\ufffd") ||
        Buffer.byteLength(key) > 1_024
      )
        throw failure()
      if (!keys.has(key)) {
        scannedBytes += Buffer.byteLength(key)
        if (keys.size >= maxKeys || scannedBytes > 2 * 1024 * 1024)
          throw failure()
        keys.add(key)
      }
    }
    cursor = next
  } while (cursor !== "0")

  const categories = Object.fromEntries(
    categoryNames.map((name) => [
      name,
      {
        count: 0,
        types: blankCounts(typeNames),
        ttl: blankCounts(ttlNames),
      },
    ])
  )
  const types = new Map()
  const list = [...keys]
  for (let offset = 0; offset < list.length; offset += 64) {
    const batch = list.slice(offset, offset + 64)
    const observations = await run(() =>
      Promise.all(
        batch.map(async (key) => [
          await client.type(key),
          await client.pTTL(key),
        ])
      )
    )
    for (let index = 0; index < batch.length; index++) {
      const key = batch[index]
      const [type, ttl] = observations[index]
      const category = categoryFor(key)
      const summary = categories[category]
      const bucket = ttlBucket(ttl)
      summary.ttl[bucket] += 1
      if (type === "none" && ttl === -2) continue
      if (
        typeof type !== "string" ||
        type.length > 64 ||
        !/^[a-z][a-z0-9_-]*$/u.test(type) ||
        type === "none" ||
        ttl === -2 ||
        (expectedString.has(category) && type !== "string")
      )
        throw failure()
      summary.count += 1
      summary.types[typeNames.includes(type) ? type : "other"] += 1
      types.set(key, type)
    }
  }

  const queues = {}
  for (const [name, prefix] of queueDefinitions) {
    const states = {}
    for (const [suffix, expectedType, method] of stateDefinitions) {
      const key = `${prefix}:${suffix}`
      const type = types.get(key)
      if (type === undefined) {
        states[suffix] = 0
        continue
      }
      if (type !== expectedType) throw failure()
      states[suffix] = integer(await run(() => client[method](key)))
    }
    queues[name] = {
      keyCount: categories[name].count,
      states,
    }
  }
  return {
    schemaVersion: 1,
    scannedKeys: keys.size,
    categories,
    queues,
  }
}

export const collectRedisQueueAggregate = async (options) => {
  try {
    return await collectRedisQueueAggregateInner(options)
  } catch {
    throw failure()
  }
}

const withIsolatedRedisClient = async ({ socketPath, signal }, collect) => {
  if (
    typeof socketPath !== "string" ||
    !/^\/tmp\/rr-redis-replay-[A-Za-z0-9_-]+\/socket\/redis\.sock$/u.test(
      socketPath
    ) ||
    resolve(socketPath) !== socketPath
  )
    throw failure()
  const socketDirectory = dirname(socketPath)
  let observed
  try {
    observed = await Promise.all([
      lstat(socketDirectory, { bigint: true }),
      lstat(socketPath, { bigint: true }),
      realpath(socketDirectory),
    ])
  } catch {
    throw failure()
  }
  const [directory, socket, canonicalDirectory] = observed
  if (
    !directory.isDirectory() ||
    !socket.isSocket() ||
    (directory.mode & 0o077n) !== 0n ||
    (socket.mode & 0o077n) !== 0n ||
    directory.uid !== BigInt(process.getuid()) ||
    socket.uid !== BigInt(process.getuid()) ||
    canonicalDirectory !== socketDirectory
  )
    throw failure()
  const client = createClient({
    socket: {
      path: socketPath,
      connectTimeout: 1_000,
      reconnectStrategy: false,
    },
    disableOfflineQueue: true,
  })
  client.on("error", () => undefined)
  try {
    await client.connect()
    return await collect(client, signal)
  } catch {
    throw failure()
  } finally {
    client.destroy()
  }
}

export const collectIsolatedRedisQueueAggregate = ({ socketPath, signal }) =>
  withIsolatedRedisClient({ socketPath, signal }, (client) =>
    collectRedisQueueAggregate({ client, signal })
  )

export const collectIsolatedRedisFailedJobs = ({
  socketPath,
  signal,
  expectedFailed,
}) =>
  withIsolatedRedisClient({ socketPath, signal }, (client) =>
    classifyIsolatedFailedJobs({ client, signal, expectedFailed })
  )
