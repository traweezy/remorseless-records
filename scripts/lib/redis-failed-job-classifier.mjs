const unavailable = () =>
  new Error("Redis failed-job classification unavailable.")

const queueDefinitions = Object.freeze([
  ["eventBus", "RedisEventBusService:events-queue"],
  ["scheduledJobs", "bull:medusa-workflows-jobs"],
])
export const scheduledNames = Object.freeze([
  "reconcile-checkout-payments",
  "reconcile-stripe-lifecycle-events",
  "reconcile-tax-evidence",
  "remove-abandoned-guest-checkouts",
  "remove-expired-anonymous-carts",
  "sync-taxrate-io-quota",
])
const reasonBuckets = Object.freeze([
  "missingHash",
  "missingReason",
  "oversizedReason",
  "missingLock",
  "stalled",
  "timeoutHint",
  "providerHint",
  "infrastructureHint",
  "other",
])
const attemptBuckets = Object.freeze([
  "missingHash",
  "missingOrInvalid",
  "zero",
  "one",
  "multiple",
])
const nameBuckets = Object.freeze([
  ...scheduledNames,
  "missingHash",
  "missingName",
  "oversizedName",
  "missingData",
  "oversizedData",
  "invalidData",
  "unlisted",
])
const blank = (names) => Object.fromEntries(names.map((name) => [name, 0]))
const boundedCount = (value, maximum) =>
  Number.isSafeInteger(value) && value >= 0 && value <= maximum
const maxFailedSetMemoryBytes = 256 * 1024
const maxScheduledDataBytes = 1_024
const maxTotalScheduledDataBytes = 256 * 1024

const scheduledCategory = (rawData) => {
  try {
    const data = JSON.parse(rawData)
    if (
      data === null ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      typeof data.jobId !== "string" ||
      data.jobId.length === 0 ||
      Buffer.byteLength(data.jobId) > 128
    )
      return "invalidData"
    return (
      scheduledNames.find((name) => data.jobId === `job-${name}`) ?? "unlisted"
    )
  } catch {
    return "invalidData"
  }
}

// These are lexical hints for triage, not a diagnosis of the failed job.
const reasonBucket = (reason) => {
  if (reason === null) return "missingReason"
  const firstLine = reason.split(/\r?\n/u, 1)[0].slice(0, 512).toLowerCase()
  if (/^missing lock for job\b/u.test(firstLine)) return "missingLock"
  if (/^job stalled more than allowable limit\b/u.test(firstLine))
    return "stalled"
  if (/\b(?:timeout|timed out|deadline exceeded|etimedout)\b/u.test(firstLine))
    return "timeoutHint"
  if (/\b(?:stripe|taxjar|taxrate|upstream provider)\b/u.test(firstLine))
    return "providerHint"
  if (
    /\b(?:econnreset|econnrefused|redis|postgres|database unavailable)\b/u.test(
      firstLine
    )
  )
    return "infrastructureHint"
  return "other"
}

const classifyInner = async ({
  client,
  expectedFailed,
  signal,
  clock = Date.now,
  timeoutMs = 30_000,
  maxFailedJobs = 500,
}) => {
  if (
    !client ||
    !expectedFailed ||
    Object.keys(expectedFailed).sort().join(",") !== "eventBus,scheduledJobs" ||
    !boundedCount(expectedFailed.eventBus, maxFailedJobs) ||
    !boundedCount(expectedFailed.scheduledJobs, maxFailedJobs) ||
    expectedFailed.eventBus + expectedFailed.scheduledJobs > maxFailedJobs ||
    !Number.isSafeInteger(maxFailedJobs) ||
    maxFailedJobs < 1 ||
    maxFailedJobs > 500 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 30_000
  )
    throw unavailable()
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
  let totalIdBytes = 0
  let totalReasonBytes = 0
  let totalScheduledDataBytes = 0
  const queues = {}
  const inventories = []
  // Sample every nested value before any range reply can materialize IDs.
  for (const [queueName, prefix] of queueDefinitions) {
    const failedKey = `${prefix}:failed`
    const count = await run(() => client.zCard(failedKey))
    if (
      !boundedCount(count, maxFailedJobs) ||
      count !== expectedFailed[queueName]
    )
      throw unavailable()
    const memoryBytes = await run(() =>
      client.memoryUsage(failedKey, { SAMPLES: 0 })
    )
    if (
      (count === 0 && memoryBytes !== null) ||
      (count > 0 &&
        (!boundedCount(memoryBytes, maxFailedSetMemoryBytes) ||
          memoryBytes === 0))
    )
      throw unavailable()
    inventories.push({ queueName, prefix, failedKey, count })
  }
  for (const { queueName, prefix, failedKey, count } of inventories) {
    const ids =
      count === 0 ? [] : await run(() => client.zRange(failedKey, 0, -1))
    if (!Array.isArray(ids) || ids.length !== count) throw unavailable()
    const names = blank(nameBuckets)
    const reasons = blank(reasonBuckets)
    const attempts = blank(attemptBuckets)
    const seen = new Set()
    for (const id of ids) {
      if (
        typeof id !== "string" ||
        id.length === 0 ||
        id.includes("\0") ||
        id.includes("\ufffd") ||
        Buffer.byteLength(id) > 256 ||
        (queueName === "scheduledJobs" &&
          !/^repeat:schedule_job-[A-Za-z0-9_-]{1,80}:[0-9]{13}$/u.test(id)) ||
        seen.has(id)
      )
        throw unavailable()
      seen.add(id)
      totalIdBytes += Buffer.byteLength(id)
      if (totalIdBytes > 64 * 1024) throw unavailable()
      const hashKey = `${prefix}:${id}`
      const type = await run(() => client.type(hashKey))
      if (type === "none") {
        names.missingHash++
        reasons.missingHash++
        attempts.missingHash++
        continue
      }
      if (type !== "hash") throw unavailable()
      const measuredFields =
        queueName === "scheduledJobs"
          ? ["name", "failedReason", "atm"]
          : ["failedReason", "atm"]
      const fieldLengths = await run(() =>
        Promise.all(
          measuredFields.map((field) => client.hStrLen(hashKey, field))
        )
      )
      if (
        !fieldLengths.every((length) =>
          boundedCount(length, Number.MAX_SAFE_INTEGER)
        )
      )
        throw unavailable()
      const lengths = Object.fromEntries(
        measuredFields.map((field, index) => [field, fieldLengths[index]])
      )
      const nameLength = lengths.name
      const reasonLength = lengths.failedReason
      const attemptsLength = lengths.atm
      const fields = [
        ...(queueName === "scheduledJobs" && nameLength <= 128 ? ["name"] : []),
        ...(reasonLength <= 4_096 ? ["failedReason"] : []),
        ...(attemptsLength <= 10 ? ["atm"] : []),
      ]
      const values = fields.length
        ? await run(() => client.hmGet(hashKey, fields))
        : []
      if (!Array.isArray(values) || values.length !== fields.length)
        throw unavailable()
      const fieldValues = Object.fromEntries(
        fields.map((field, index) => [field, values[index]])
      )
      const name = fieldValues.name
      if (queueName === "eventBus") names.unlisted++
      else if (nameLength > 128) names.oversizedName++
      else if (name === null || name === "") names.missingName++
      else if (
        typeof name !== "string" ||
        Buffer.byteLength(name) !== nameLength
      )
        throw unavailable()
      else if (name === "schedule") {
        const dataLength = await run(() => client.hStrLen(hashKey, "data"))
        if (!boundedCount(dataLength, Number.MAX_SAFE_INTEGER))
          throw unavailable()
        if (dataLength === 0) names.missingData++
        else if (dataLength > maxScheduledDataBytes) names.oversizedData++
        else {
          totalScheduledDataBytes += dataLength
          if (totalScheduledDataBytes > maxTotalScheduledDataBytes)
            throw unavailable()
          const dataValues = await run(() => client.hmGet(hashKey, ["data"]))
          if (!Array.isArray(dataValues) || dataValues.length !== 1)
            throw unavailable()
          const rawData = dataValues[0]
          if (
            typeof rawData !== "string" ||
            Buffer.byteLength(rawData) !== dataLength
          )
            throw unavailable()
          names[scheduledCategory(rawData)]++
        }
      } else names.unlisted++
      const reason = fieldValues.failedReason
      if (reasonLength > 4_096) reasons.oversizedReason++
      else if (reason === null || reason === "") reasons.missingReason++
      else if (
        typeof reason !== "string" ||
        Buffer.byteLength(reason) !== reasonLength
      )
        throw unavailable()
      else {
        totalReasonBytes += reasonLength
        if (totalReasonBytes > 1024 * 1024) throw unavailable()
        reasons[reasonBucket(reason)]++
      }
      const attempt = fieldValues.atm
      if (
        attemptsLength > 10 ||
        attempt === null ||
        typeof attempt !== "string" ||
        Buffer.byteLength(attempt) !== attemptsLength ||
        !/^(?:0|[1-9][0-9]{0,9})$/u.test(attempt)
      )
        attempts.missingOrInvalid++
      else if (attempt === "0") attempts.zero++
      else if (attempt === "1") attempts.one++
      else attempts.multiple++
    }
    for (const bucket of [names, reasons, attempts])
      if (
        Object.values(bucket).reduce((sum, value) => sum + value, 0) !== count
      )
        throw unavailable()
    queues[queueName] = { failedCount: count, names, reasons, attempts }
  }
  return {
    schemaVersion: 2,
    source: "isolated_capture_only",
    heuristicReasonClasses: true,
    totalFailed: expectedFailed.eventBus + expectedFailed.scheduledJobs,
    queues,
    queueReconciled: false,
    businessReconciled: false,
  }
}

export const classifyIsolatedFailedJobs = async (options) => {
  try {
    return await classifyInner(options)
  } catch {
    throw unavailable()
  }
}
