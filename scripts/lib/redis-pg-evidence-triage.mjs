import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { scheduledNames } from "./redis-failed-job-classifier.mjs"
import { validateLiveAggregate } from "../redis-live-queue-aggregate.mjs"
import { parseBusinessAggregateOutput } from "./postgres-business-aggregate.mjs"

const unavailable = () => new Error("Recovery evidence comparison unavailable.")
const hashPattern = /^[a-f0-9]{64}$/u
const queueNames = ["eventBus", "scheduledJobs"]
const nameBuckets = [
  ...scheduledNames,
  "missingHash",
  "missingName",
  "oversizedName",
  "missingData",
  "oversizedData",
  "invalidData",
  "unlisted",
]
const reasonBuckets = [
  "missingHash",
  "missingReason",
  "oversizedReason",
  "missingLock",
  "stalled",
  "timeoutHint",
  "providerHint",
  "infrastructureHint",
  "other",
]
const attemptBuckets = [
  "missingHash",
  "missingOrInvalid",
  "zero",
  "one",
  "multiple",
]
const replayKeys = [
  "aggregateRestart",
  "aggregateStartup",
  "businessReconciled",
  "checkerSha256",
  "copiedBytes",
  "databaseCount",
  "event",
  "expiringKeys",
  "failedJobs",
  "fileCount",
  "keyCount",
  "manifestSha256",
  "queueReconciled",
  "receiptSha256",
  "restartProven",
  "schemaVersion",
  "setSha256",
  "sourceFingerprint",
  "startupProven",
  "targetImageId",
]
const liveRedisKeys = [
  "businessReconciled",
  "categories",
  "event",
  "observedAtEnd",
  "observedAtStart",
  "queueReconciled",
  "queues",
  "readOnly",
  "scannedKeys",
  "schemaVersion",
  "sourceIdentityVerified",
]
const livePostgresKeys = [
  "businessReconciled",
  "durationMs",
  "event",
  "observedAtEnd",
  "observedAtStart",
  "physicalRelationCounts",
  "readOnly",
  "schemaVersion",
  "source",
  "sourceIdentityVerified",
  "stripeLifecycleEvents",
  "taxQuoteEvidence",
]

const exactKeys = (value, keys) => {
  assert.ok(value && typeof value === "object" && !Array.isArray(value))
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort())
}

const count = (value, maximum = 5_000) => {
  assert.ok(Number.isSafeInteger(value) && value >= 0 && value <= maximum)
  return value
}

const countBuckets = (value, keys, total) => {
  exactKeys(value, keys)
  assert.equal(
    keys.reduce((sum, key) => sum + count(value[key], total), 0),
    total
  )
}

const parseBound = (raw, expectedSha256, maxBytes) => {
  assert.equal(typeof raw, "string")
  assert.match(expectedSha256, hashPattern)
  assert.ok(Buffer.byteLength(raw, "utf8") <= maxBytes)
  assert.equal(createHash("sha256").update(raw).digest("hex"), expectedSha256)
  return JSON.parse(raw)
}

const parseWindow = (start, end, maximumMs) => {
  for (const value of [start, end]) {
    assert.equal(typeof value, "string")
    assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
    assert.equal(new Date(value).toISOString(), value)
  }
  const startMs = Date.parse(start)
  const endMs = Date.parse(end)
  assert.ok(endMs >= startMs && endMs - startMs <= maximumMs)
  return { startMs, endMs }
}

const queueFailedCounts = (aggregate) => {
  validateLiveAggregate(aggregate)
  return Object.fromEntries(
    queueNames.map((name) => [name, aggregate.queues[name].states.failed])
  )
}

const classifyCounts = (classification) => {
  exactKeys(classification, [
    "businessReconciled",
    "heuristicReasonClasses",
    "queueReconciled",
    "queues",
    "schemaVersion",
    "source",
    "totalFailed",
  ])
  assert.equal(classification.schemaVersion, 2)
  assert.equal(classification.source, "isolated_capture_only")
  assert.equal(classification.heuristicReasonClasses, true)
  assert.equal(classification.queueReconciled, false)
  assert.equal(classification.businessReconciled, false)
  exactKeys(classification.queues, queueNames)
  const failed = Object.fromEntries(
    queueNames.map((name) => {
      const queue = classification.queues[name]
      exactKeys(queue, ["attempts", "failedCount", "names", "reasons"])
      const total = count(queue.failedCount)
      countBuckets(queue.names, nameBuckets, total)
      countBuckets(queue.reasons, reasonBuckets, total)
      countBuckets(queue.attempts, attemptBuckets, total)
      return [name, total]
    })
  )
  assert.equal(
    count(classification.totalFailed),
    failed.eventBus + failed.scheduledJobs
  )
  return failed
}

// These independently timed, count-only reports cannot link a job to a cart,
// payment, order, or provider event. This comparison never authorizes replay.
export const compareRecoveryEvidence = ({
  isolatedReplayRaw,
  isolatedReplaySha256,
  liveRedisRaw,
  liveRedisSha256,
  livePostgresRaw,
  livePostgresSha256,
}) => {
  try {
    const replay = parseBound(isolatedReplayRaw, isolatedReplaySha256, 16_384)
    const redis = parseBound(liveRedisRaw, liveRedisSha256, 8_192)
    const postgres = parseBound(livePostgresRaw, livePostgresSha256, 2_048)
    exactKeys(replay, replayKeys)
    assert.equal(replay.event, "redis.aof_isolated_replay.completed")
    assert.equal(replay.schemaVersion, 1)
    assert.equal(replay.startupProven, true)
    assert.equal(replay.restartProven, true)
    assert.equal(replay.queueReconciled, false)
    assert.equal(replay.businessReconciled, false)
    for (const name of [
      "checkerSha256",
      "manifestSha256",
      "receiptSha256",
      "setSha256",
      "sourceFingerprint",
    ])
      assert.match(replay[name], hashPattern)
    const classified = classifyCounts(replay.failedJobs)
    const startup = queueFailedCounts(replay.aggregateStartup)
    const restart = queueFailedCounts(replay.aggregateRestart)
    assert.deepEqual(startup, classified)
    assert.deepEqual(restart, classified)

    exactKeys(redis, liveRedisKeys)
    assert.equal(redis.event, "redis.live_queue_aggregate.completed")
    assert.equal(redis.sourceIdentityVerified, true)
    assert.equal(redis.readOnly, true)
    assert.equal(redis.queueReconciled, false)
    assert.equal(redis.businessReconciled, false)
    const liveFailed = queueFailedCounts({
      schemaVersion: redis.schemaVersion,
      scannedKeys: redis.scannedKeys,
      categories: redis.categories,
      queues: redis.queues,
    })
    const redisWindow = parseWindow(
      redis.observedAtStart,
      redis.observedAtEnd,
      65_000
    )

    exactKeys(postgres, livePostgresKeys)
    assert.equal(postgres.event, "postgres.live_business_aggregate.completed")
    assert.equal(postgres.schemaVersion, 1)
    assert.equal(postgres.source, "staging_postgres_live_read_only")
    assert.equal(postgres.sourceIdentityVerified, true)
    assert.equal(postgres.readOnly, true)
    assert.equal(postgres.businessReconciled, false)
    const parsedBusiness = parseBusinessAggregateOutput(
      JSON.stringify({
        schemaVersion: postgres.schemaVersion,
        physicalRelationCounts: postgres.physicalRelationCounts,
        taxQuoteEvidence: postgres.taxQuoteEvidence,
        stripeLifecycleEvents: postgres.stripeLifecycleEvents,
      })
    )
    const postgresWindow = parseWindow(
      postgres.observedAtStart,
      postgres.observedAtEnd,
      90_000
    )
    assert.equal(
      postgres.durationMs,
      postgresWindow.endMs - postgresWindow.startMs
    )

    return {
      schemaVersion: 1,
      comparisonScope: "fixed_counts_only",
      isolatedFailedTotal: classified.eventBus + classified.scheduledJobs,
      liveFailedTotal: liveFailed.eventBus + liveFailed.scheduledJobs,
      isolatedAndLiveFailedCountsAgree:
        classified.eventBus === liveFailed.eventBus &&
        classified.scheduledJobs === liveFailed.scheduledJobs,
      observedWindowsOverlap:
        redisWindow.startMs <= postgresWindow.endMs &&
        postgresWindow.startMs <= redisWindow.endMs,
      scheduledFailureCategories: Object.fromEntries(
        scheduledNames.map((name) => [
          name,
          replay.failedJobs.queues.scheduledJobs.names[name],
        ])
      ),
      postgresCounts: {
        payments: parsedBusiness.physicalRelationCounts.payments,
        orders: parsedBusiness.physicalRelationCounts.orders,
      },
      jobToBusinessIdentityVerified: false,
      providerReconciled: false,
      queueReconciled: false,
      businessReconciled: false,
      retryAuthorized: false,
    }
  } catch {
    throw unavailable()
  }
}
