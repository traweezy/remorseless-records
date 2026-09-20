const unavailable = () => new Error("Redis queue integrity unavailable.")

const queues = Object.freeze([
  ["eventBus", "RedisEventBusService:events-queue"],
  ["workflows", "bull:medusa-workflows"],
  ["scheduledJobs", "bull:medusa-workflows-jobs"],
  ["cleaner", "bull:workflows-cleaner"],
])
const states = Object.freeze([
  ["wait", "list", "lLen"],
  ["active", "list", "lLen"],
  ["paused", "list", "lLen"],
  ["delayed", "zset", "zCard"],
  ["prioritized", "zset", "zCard"],
  ["completed", "zset", "zCard"],
  ["failed", "zset", "zCard"],
  ["waiting-children", "zset", "zCard"],
])
const maxSetMemoryBytes = 512 * 1024
const maxTotalSetMemoryBytes = 2 * 1024 * 1024
const maxTotalIdBytes = 256 * 1024
const maxIdBytes = 256
const maxCaptureTimeMs = 8_640_000_000_000_000
const validCount = (value, maximum) =>
  Number.isSafeInteger(value) && value >= 0 && value <= maximum

const captureMilliseconds = (value) => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  )
    throw unavailable()
  const milliseconds = Date.parse(value)
  if (
    !Number.isSafeInteger(milliseconds) ||
    milliseconds < 0 ||
    milliseconds > maxCaptureTimeMs ||
    new Date(milliseconds).toISOString() !== value
  )
    throw unavailable()
  return milliseconds
}

const inspectInner = async ({
  client,
  expectedQueues,
  capturedAt,
  signal,
  clock = Date.now,
  timeoutMs = 30_000,
  maxMembers = 2_000,
}) => {
  if (
    !client ||
    !expectedQueues ||
    !validCount(maxMembers, 2_000) ||
    maxMembers === 0 ||
    !validCount(timeoutMs, 30_000) ||
    timeoutMs === 0
  )
    throw unavailable()
  const capturedAtMs = captureMilliseconds(capturedAt)
  const deadline = clock() + timeoutMs
  const run = async (operation) => {
    signal?.throwIfAborted()
    const remaining = deadline - clock()
    if (!Number.isFinite(remaining) || remaining <= 0) throw unavailable()
    let timer
    let onAbort
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(unavailable()), remaining)
        }),
        ...(signal
          ? [
              new Promise((_, reject) => {
                onAbort = () => reject(unavailable())
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

  // Preflight every fixed state before any command can materialize member IDs.
  const inventory = []
  let totalMembers = 0
  let totalMemoryBytes = 0
  for (const [queue, prefix] of queues) {
    const expected = expectedQueues[queue]?.states
    if (!expected) throw unavailable()
    for (const [state, kind, cardinalityMethod] of states) {
      const count = expected[state]
      if (!validCount(count, maxMembers)) throw unavailable()
      totalMembers += count
      if (totalMembers > maxMembers) throw unavailable()
      const key = `${prefix}:${state}`
      const actual = await run(() => client[cardinalityMethod](key))
      if (actual !== count) throw unavailable()
      const memory = await run(() => client.memoryUsage(key, { SAMPLES: 0 }))
      if (
        (count === 0 && memory !== null) ||
        (count > 0 && (!validCount(memory, maxSetMemoryBytes) || memory === 0))
      )
        throw unavailable()
      totalMemoryBytes += memory ?? 0
      if (totalMemoryBytes > maxTotalSetMemoryBytes) throw unavailable()
      inventory.push({ queue, prefix, state, kind, key, count })
    }
  }

  const fixed = () => ({
    members: 0,
    duplicateWithinState: 0,
    presentInMultipleStates: 0,
    missingJobHash: 0,
    wrongJobHashType: 0,
    delayedDueByReceipt: 0,
    delayedAfterReceipt: 0,
    terminalAfterReceipt: 0,
    invalidTemporalScore: 0,
  })
  const results = Object.fromEntries(queues.map(([name]) => [name, fixed()]))
  const seenPerQueue = Object.fromEntries(
    queues.map(([name]) => [name, new Map()])
  )
  let totalIdBytes = 0
  for (const { queue, prefix, state, kind, key, count } of inventory) {
    if (count === 0) continue
    const members = await run(() =>
      kind === "list"
        ? client.lRange(key, 0, -1)
        : client.zRangeWithScores(key, 0, -1)
    )
    if (!Array.isArray(members) || members.length !== count) throw unavailable()
    const inState = new Set()
    const seen = seenPerQueue[queue]
    const result = results[queue]
    for (const member of members) {
      const id = kind === "list" ? member : member?.value
      if (
        typeof id !== "string" ||
        id.length === 0 ||
        id.includes("\0") ||
        id.includes("\ufffd") ||
        Buffer.byteLength(id) > maxIdBytes
      )
        throw unavailable()
      totalIdBytes += Buffer.byteLength(id)
      if (totalIdBytes > maxTotalIdBytes) throw unavailable()
      result.members++
      if (inState.has(id)) result.duplicateWithinState++
      else {
        inState.add(id)
        if (seen.has(id)) result.presentInMultipleStates++
        else seen.set(id, prefix)
      }
      if (kind !== "zset") continue
      const score = member.score
      if (!Number.isSafeInteger(score) || score < 0) {
        result.invalidTemporalScore++
        continue
      }
      if (state === "delayed") {
        const dueAtMs = Math.floor(score / 4_096)
        if (dueAtMs <= capturedAtMs) result.delayedDueByReceipt++
        else result.delayedAfterReceipt++
      } else if (
        (state === "completed" || state === "failed") &&
        score > capturedAtMs
      )
        result.terminalAfterReceipt++
    }
  }
  for (const [queue] of queues) {
    const seen = seenPerQueue[queue]
    const result = results[queue]
    const ids = [...seen.keys()]
    for (let offset = 0; offset < ids.length; offset += 32) {
      const types = await run(() =>
        Promise.all(
          ids
            .slice(offset, offset + 32)
            .map((id) => client.type(`${seen.get(id)}:${id}`))
        )
      )
      if (
        !Array.isArray(types) ||
        types.length !== Math.min(32, ids.length - offset)
      )
        throw unavailable()
      for (const type of types) {
        if (type === "none") result.missingJobHash++
        else if (type !== "hash") result.wrongJobHashType++
      }
    }
  }
  const total = fixed()
  for (const result of Object.values(results))
    for (const key of Object.keys(total)) total[key] += result[key]
  if (total.members !== totalMembers) throw unavailable()
  return {
    schemaVersion: 1,
    source: "isolated_capture_only",
    inspectedStates: states.length * queues.length,
    queues: results,
    total,
    queueReconciled: false,
  }
}

export const inspectRedisQueueIntegrity = async (options) => {
  try {
    return await inspectInner(options)
  } catch {
    throw unavailable()
  }
}
