import assert from "node:assert/strict"
import test from "node:test"
import { classifyIsolatedFailedJobs } from "./lib/redis-failed-job-classifier.mjs"

const eventPrefix = "RedisEventBusService:events-queue"
const scheduledPrefix = "bull:medusa-workflows-jobs"
const fixture = ({ event = [], scheduled = [] } = {}) => {
  const sets = new Map([
    [`${eventPrefix}:failed`, event.map(({ id }) => id)],
    [`${scheduledPrefix}:failed`, scheduled.map(({ id }) => id)],
  ])
  const hashes = new Map(
    [
      ...event.map((job) => [`${eventPrefix}:${job.id}`, job.fields]),
      ...scheduled.map((job) => [`${scheduledPrefix}:${job.id}`, job.fields]),
    ].filter(([, fields]) => fields !== undefined)
  )
  const readFields = []
  const readOperations = []
  const setReads = []
  const client = {
    zCard: async (key) => {
      setReads.push(["zCard", key])
      return sets.get(key).length
    },
    memoryUsage: async (key, options) => {
      setReads.push(["memoryUsage", key, options])
      const ids = sets.get(key)
      return ids.length === 0
        ? null
        : 128 + ids.reduce((sum, id) => sum + Buffer.byteLength(id) + 16, 0)
    },
    zRange: async (key) => {
      setReads.push(["zRange", key])
      return sets.get(key)
    },
    type: async (key) => (hashes.has(key) ? "hash" : "none"),
    hStrLen: async (key, field) => {
      readFields.push(field)
      readOperations.push([key, field])
      return Buffer.byteLength(hashes.get(key)[field] ?? "")
    },
    hmGet: async (key, fields) => {
      readFields.push(...fields)
      readOperations.push(...fields.map((field) => [key, field]))
      return fields.map((field) => hashes.get(key)[field] ?? null)
    },
  }
  return { client, readFields, readOperations, setReads }
}

test("classifies all 238 captured failures with fixed count-only buckets", async () => {
  const scheduled = Array.from({ length: 237 }, (_, index) => ({
    id: `private-scheduled-${index}`,
    fields: {
      name:
        index < 230
          ? "reconcile-checkout-payments"
          : "reconcile-stripe-lifecycle-events",
      failedReason:
        index < 230
          ? "Missing lock for job private-customer-order"
          : "Stripe provider unavailable for private customer",
      attemptsMade: index < 230 ? "1" : "2",
      data: "private customer payload",
      stacktrace: "private stack trace",
    },
  }))
  const { client, readFields, readOperations, setReads } = fixture({
    event: [
      {
        id: "private-event-1",
        fields: {
          name: "private.event",
          failedReason: "job stalled more than allowable limit private payload",
          attemptsMade: "0",
          data: "private event payload",
        },
      },
    ],
    scheduled,
  })
  const result = await classifyIsolatedFailedJobs({
    client,
    expectedFailed: { eventBus: 1, scheduledJobs: 237 },
  })
  assert.equal(result.totalFailed, 238)
  assert.equal(result.queues.eventBus.reasons.stalled, 1)
  assert.equal(result.queues.eventBus.names.unlisted, 1)
  assert.equal(result.queues.scheduledJobs.reasons.missingLock, 230)
  assert.equal(result.queues.scheduledJobs.reasons.providerHint, 7)
  assert.equal(
    result.queues.scheduledJobs.names["reconcile-checkout-payments"],
    230
  )
  assert.equal(result.queues.scheduledJobs.attempts.multiple, 7)
  assert.equal(result.queueReconciled, false)
  assert.equal(result.businessReconciled, false)
  assert.deepEqual([...new Set(readFields)].sort(), [
    "attemptsMade",
    "failedReason",
    "name",
  ])
  assert.equal(
    readOperations.some(
      ([key, field]) => key.startsWith(`${eventPrefix}:`) && field === "name"
    ),
    false
  )
  assert.deepEqual(
    setReads
      .filter(([operation]) => operation === "memoryUsage")
      .map(([, , options]) => options),
    [{ SAMPLES: 0 }, { SAMPLES: 0 }]
  )
  assert.equal(
    setReads.findIndex(([operation]) => operation === "zRange") > 3,
    true
  )
  assert.doesNotMatch(
    JSON.stringify(result),
    /private|customer|payload|stack|order|event-1/u
  )
})

test("rejects oversized or missing set memory before reading any failed IDs", async () => {
  for (const memoryBytes of [256 * 1024 + 1, null, -1, 1.5]) {
    const { client, setReads } = fixture({
      event: [{ id: "event-a", fields: {} }],
      scheduled: [{ id: "scheduled-a", fields: {} }],
    })
    const originalMemoryUsage = client.memoryUsage
    client.memoryUsage = async (key, options) =>
      key === `${scheduledPrefix}:failed`
        ? memoryBytes
        : originalMemoryUsage(key, options)
    await assert.rejects(
      classifyIsolatedFailedJobs({
        client,
        expectedFailed: { eventBus: 1, scheduledJobs: 1 },
      }),
      { message: "Redis failed-job classification unavailable." }
    )
    assert.equal(
      setReads.some(([operation]) => operation === "zRange"),
      false
    )
  }
})

test("counts missing and oversized metadata without retrieving oversized values", async () => {
  const oversized = "private".repeat(1_000)
  const { client, readFields } = fixture({
    event: [{ id: "missing-hash" }],
    scheduled: [
      {
        id: "oversized",
        fields: {
          name: "n".repeat(129),
          failedReason: oversized,
          attemptsMade: "not-a-count",
        },
      },
      {
        id: "missing-fields",
        fields: {},
      },
    ],
  })
  const result = await classifyIsolatedFailedJobs({
    client,
    expectedFailed: { eventBus: 1, scheduledJobs: 2 },
  })
  assert.equal(result.queues.eventBus.names.missingHash, 1)
  assert.equal(result.queues.scheduledJobs.names.oversizedName, 1)
  assert.equal(result.queues.scheduledJobs.names.missingName, 1)
  assert.equal(result.queues.scheduledJobs.reasons.oversizedReason, 1)
  assert.equal(result.queues.scheduledJobs.reasons.missingReason, 1)
  assert.equal(result.queues.scheduledJobs.attempts.missingOrInvalid, 2)
  assert.equal(readFields.filter((field) => field === "failedReason").length, 3)
  assert.doesNotMatch(JSON.stringify(result), /private/u)
})

test("fails closed on count drift, duplicate or malformed IDs, wrong type, and deadline", async () => {
  const base = fixture({
    event: [
      {
        id: "event-a",
        fields: { name: "x", failedReason: "x", attemptsMade: "1" },
      },
    ],
  }).client
  const failures = [
    { client: base, expectedFailed: { eventBus: 0, scheduledJobs: 0 } },
    {
      client: {
        ...base,
        zCard: async (key) => (key === `${eventPrefix}:failed` ? 2 : 0),
        zRange: async () => ["same", "same"],
      },
      expectedFailed: { eventBus: 2, scheduledJobs: 0 },
    },
    {
      client: { ...base, zRange: async () => ["x".repeat(257)] },
      expectedFailed: { eventBus: 1, scheduledJobs: 0 },
    },
    {
      client: { ...base, type: async () => "string" },
      expectedFailed: { eventBus: 1, scheduledJobs: 0 },
    },
    {
      client: {
        ...base,
        hStrLen: async () => {
          throw new Error("private job error")
        },
      },
      expectedFailed: { eventBus: 1, scheduledJobs: 0 },
    },
    {
      client: { ...base, zCard: () => new Promise(() => undefined) },
      expectedFailed: { eventBus: 1, scheduledJobs: 0 },
      timeoutMs: 10,
    },
    { client: base, expectedFailed: { eventBus: 1, scheduledJobs: 500 } },
  ]
  for (const options of failures)
    await assert.rejects(classifyIsolatedFailedJobs(options), {
      message: "Redis failed-job classification unavailable.",
    })
})
