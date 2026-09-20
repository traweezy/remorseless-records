import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { compareRecoveryEvidence } from "./lib/redis-pg-evidence-triage.mjs"
import { scheduledNames } from "./lib/redis-failed-job-classifier.mjs"

const zero = (names) => Object.fromEntries(names.map((name) => [name, 0]))
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
const states = [
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
const names = [
  ...scheduledNames,
  "missingHash",
  "missingName",
  "oversizedName",
  "missingData",
  "oversizedData",
  "invalidData",
  "unlisted",
]
const reasons = [
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
const attempts = ["missingHash", "missingOrInvalid", "zero", "one", "multiple"]

const aggregate = () => ({
  schemaVersion: 1,
  scannedKeys: 0,
  categories: Object.fromEntries(
    categoryNames.map((name) => [
      name,
      {
        count: 0,
        types: zero([
          "string",
          "list",
          "set",
          "zset",
          "hash",
          "stream",
          "other",
        ]),
        ttl: zero([
          "persistent",
          "under30Seconds",
          "under10Minutes",
          "over10Minutes",
          "vanishedDuringScan",
        ]),
      },
    ])
  ),
  queues: Object.fromEntries(
    queueNames.map((name) => [name, { keyCount: 0, states: zero(states) }])
  ),
})

const classifierQueue = (failedCount, name) => ({
  failedCount,
  names: { ...zero(names), [name]: failedCount },
  reasons: { ...zero(reasons), other: failedCount },
  attempts: { ...zero(attempts), one: failedCount },
})

const evidence = () => {
  const isolated = aggregate()
  isolated.queues.eventBus.states.failed = 1
  isolated.queues.scheduledJobs.states.failed = 237
  const replay = {
    schemaVersion: 1,
    event: "redis.aof_isolated_replay.completed",
    aggregateStartup: isolated,
    aggregateRestart: structuredClone(isolated),
    failedJobs: {
      schemaVersion: 2,
      source: "isolated_capture_only",
      heuristicReasonClasses: true,
      totalFailed: 238,
      queues: {
        eventBus: classifierQueue(1, "unlisted"),
        scheduledJobs: classifierQueue(237, "reconcile-checkout-payments"),
      },
      queueReconciled: false,
      businessReconciled: false,
    },
    startupProven: true,
    restartProven: true,
    queueReconciled: false,
    businessReconciled: false,
    checkerSha256: "a".repeat(64),
    manifestSha256: "b".repeat(64),
    receiptSha256: "c".repeat(64),
    setSha256: "d".repeat(64),
    sourceFingerprint: "e".repeat(64),
    copiedBytes: 123,
    databaseCount: 1,
    expiringKeys: 0,
    fileCount: 3,
    keyCount: 0,
    targetImageId: `sha256:${"f".repeat(64)}`,
  }
  const redis = {
    ...aggregate(),
    event: "redis.live_queue_aggregate.completed",
    observedAtStart: "2026-09-20T04:34:24.959Z",
    observedAtEnd: "2026-09-20T04:34:29.279Z",
    sourceIdentityVerified: true,
    readOnly: true,
    queueReconciled: false,
    businessReconciled: false,
  }
  redis.queues.eventBus.states.failed = 1
  redis.queues.scheduledJobs.states.failed = 237
  const postgres = {
    schemaVersion: 1,
    event: "postgres.live_business_aggregate.completed",
    source: "staging_postgres_live_read_only",
    observedAtStart: "2026-09-20T08:47:55.863Z",
    observedAtEnd: "2026-09-20T08:48:00.315Z",
    durationMs: 4_452,
    sourceIdentityVerified: true,
    readOnly: true,
    businessReconciled: false,
    physicalRelationCounts: {
      carts: 68,
      paymentCollections: 49,
      paymentSessions: 44,
      payments: 7,
      orders: 7,
      orderCarts: 7,
      captures: 7,
      refunds: 0,
      orderTransactions: 7,
    },
    taxQuoteEvidence: {
      prepared: 0,
      succeeded: 2,
      canceled: 0,
      failed: 0,
      associationFailed: 0,
      disputed: 0,
      partiallyRefunded: 0,
      refunded: 0,
      unknown: 0,
      collect: 2,
      disabled: 0,
      unknownCollectionMode: 0,
    },
    stripeLifecycleEvents: {
      activeTotal: 10,
      received: 0,
      processing: 0,
      processed: 0,
      ignored: 10,
      failed: 0,
      unknown: 0,
      livemode: 0,
    },
  }
  return { replay, redis, postgres }
}

const hashed = (reports) => {
  const raw = Object.fromEntries(
    Object.entries(reports).map(([name, value]) => [
      name,
      JSON.stringify(value),
    ])
  )
  const digest = (value) => createHash("sha256").update(value).digest("hex")
  return {
    isolatedReplayRaw: raw.replay,
    isolatedReplaySha256: digest(raw.replay),
    liveRedisRaw: raw.redis,
    liveRedisSha256: digest(raw.redis),
    livePostgresRaw: raw.postgres,
    livePostgresSha256: digest(raw.postgres),
  }
}

test("compares fixed failed counts without granting business or retry authority", () => {
  const result = compareRecoveryEvidence(hashed(evidence()))
  assert.deepEqual(result, {
    schemaVersion: 1,
    comparisonScope: "fixed_counts_only",
    isolatedFailedTotal: 238,
    liveFailedTotal: 238,
    isolatedAndLiveFailedCountsAgree: true,
    observedWindowsOverlap: false,
    scheduledFailureCategories: {
      "reconcile-checkout-payments": 237,
      "reconcile-stripe-lifecycle-events": 0,
      "reconcile-tax-evidence": 0,
      "remove-abandoned-guest-checkouts": 0,
      "remove-expired-anonymous-carts": 0,
      "sync-taxrate-io-quota": 0,
    },
    postgresCounts: { payments: 7, orders: 7 },
    jobToBusinessIdentityVerified: false,
    providerReconciled: false,
    queueReconciled: false,
    businessReconciled: false,
    retryAuthorized: false,
  })
})

test("reports live count drift without claiming reconciliation", () => {
  const reports = evidence()
  reports.redis.queues.scheduledJobs.states.failed = 236
  const result = compareRecoveryEvidence(hashed(reports))
  assert.equal(result.isolatedAndLiveFailedCountsAgree, false)
  assert.equal(result.queueReconciled, false)
  assert.equal(result.retryAuthorized, false)
})

test("overlapping observation windows still cannot authorize a retry", () => {
  const reports = evidence()
  reports.postgres.observedAtStart = "2026-09-20T04:34:25.000Z"
  reports.postgres.observedAtEnd = "2026-09-20T04:34:29.452Z"
  const result = compareRecoveryEvidence(hashed(reports))
  assert.equal(result.observedWindowsOverlap, true)
  assert.equal(result.jobToBusinessIdentityVerified, false)
  assert.equal(result.businessReconciled, false)
  assert.equal(result.retryAuthorized, false)
})

test("rejects tampered hashes, oversized reports, and hidden payload fields", () => {
  const original = hashed(evidence())
  for (const changed of [
    { ...original, isolatedReplaySha256: "0".repeat(64) },
    { ...original, liveRedisRaw: `${original.liveRedisRaw}private` },
    { ...original, livePostgresRaw: "x".repeat(2_049) },
  ])
    assert.throws(() => compareRecoveryEvidence(changed), {
      message: "Recovery evidence comparison unavailable.",
    })
  const reports = evidence()
  reports.replay.privateJobId = "private-customer-order"
  assert.throws(
    () => compareRecoveryEvidence(hashed(reports)),
    (error) => {
      assert.equal(error.message, "Recovery evidence comparison unavailable.")
      assert.doesNotMatch(error.stack, /private-customer-order/u)
      return true
    }
  )
})

test("rejects forged proof, inflated buckets, invalid windows, and source drift", () => {
  for (const mutate of [
    (reports) => {
      reports.replay.restartProven = false
    },
    (reports) => {
      reports.replay.failedJobs.queues.scheduledJobs.names.unlisted = 1
    },
    (reports) => {
      reports.replay.aggregateRestart.queues.scheduledJobs.states.failed = 236
    },
    (reports) => {
      reports.redis.sourceIdentityVerified = false
    },
    (reports) => {
      reports.redis.observedAtEnd = "2026-09-20T04:34:20.000Z"
    },
    (reports) => {
      reports.postgres.durationMs = 1
    },
    (reports) => {
      reports.postgres.businessReconciled = true
    },
    (reports) => {
      reports.postgres.physicalRelationCounts.payments = -1
    },
  ]) {
    const reports = evidence()
    mutate(reports)
    assert.throws(() => compareRecoveryEvidence(hashed(reports)), {
      message: "Recovery evidence comparison unavailable.",
    })
  }
})
