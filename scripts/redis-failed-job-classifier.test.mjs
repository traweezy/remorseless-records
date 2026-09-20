import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import test from "node:test"
import {
  classifyIsolatedFailedJobs,
  scheduledNames,
} from "./lib/redis-failed-job-classifier.mjs"

const eventPrefix = "RedisEventBusService:events-queue"
const scheduledPrefix = "bull:medusa-workflows-jobs"
const jobsDirectory = new URL("../backend/src/jobs/", import.meta.url)
const scheduledId = (index) =>
  `repeat:schedule_job-sync-taxrate-io-quota:${1_790_000_000_000 + index}`

test("scheduled category allowlist matches every checked-in app job", () => {
  const names = readdirSync(jobsDirectory)
    .filter((entry) => entry.endsWith(".ts") && !entry.endsWith(".test.ts"))
    .map((entry) => {
      const source = readFileSync(new URL(entry, jobsDirectory), "utf8")
      const match = /\bexport const config\s*=\s*\{\s*name:\s*"([^"]+)"/u.exec(
        source
      )
      assert.ok(match, `Missing fixed scheduler config in ${entry}`)
      return match[1]
    })
    .sort()
  assert.equal(new Set(names).size, names.length)
  assert.deepEqual(names, [...scheduledNames].sort())
})

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
  const valueReads = []
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
      valueReads.push(...fields.map((field) => [key, field]))
      return fields.map((field) => hashes.get(key)[field] ?? null)
    },
  }
  return { client, readFields, readOperations, valueReads, setReads }
}

test("classifies all 238 captured failures with fixed count-only buckets", async () => {
  const scheduled = Array.from({ length: 237 }, (_, index) => ({
    id: scheduledId(index),
    fields: {
      name: "schedule",
      data: JSON.stringify({
        jobId:
          index < 230
            ? "job-reconcile-checkout-payments"
            : "job-reconcile-stripe-lifecycle-events",
        schedulerOptions: { cron: "*/5 * * * *" },
      }),
      failedReason:
        index < 230
          ? "Missing lock for job private-customer-order"
          : "Stripe provider unavailable for private customer",
      atm: index < 230 ? "1" : "2",
      attemptsMade: "private legacy value must not be read",
      stacktrace: "private stack trace",
    },
  }))
  const { client, readFields, readOperations, valueReads, setReads } = fixture({
    event: [
      {
        id: "private-event-1",
        fields: {
          name: "private.event",
          failedReason: "job stalled more than allowable limit private payload",
          atm: "0",
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
  assert.equal(result.schemaVersion, 2)
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
    "atm",
    "data",
    "failedReason",
    "name",
  ])
  assert.equal(
    readOperations.some(
      ([key, field]) => key.startsWith(`${eventPrefix}:`) && field === "name"
    ),
    false
  )
  assert.equal(
    valueReads.some(
      ([key, field]) =>
        key.startsWith(`${eventPrefix}:`) &&
        (field === "name" || field === "data")
    ),
    false
  )
  assert.equal(readFields.includes("attemptsMade"), false)
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

test("rejects unsafe scheduled job IDs without printing or fetching their hashes", async () => {
  for (const id of [
    "private/job",
    "private\njob",
    "x".repeat(129),
    `repeat:${"a".repeat(32)}:1790000000000`,
  ]) {
    const { client, readFields } = fixture({
      scheduled: [{ id, fields: { name: "schedule" } }],
    })
    await assert.rejects(
      classifyIsolatedFailedJobs({
        client,
        expectedFailed: { eventBus: 0, scheduledJobs: 1 },
      }),
      (error) => {
        assert.equal(
          error.message,
          "Redis failed-job classification unavailable."
        )
        assert.ok(!error.stack.includes(id))
        return true
      }
    )
    assert.deepEqual(readFields, [])
  }
})

test("counts missing and oversized metadata without retrieving oversized values", async () => {
  const oversized = "private".repeat(1_000)
  const { client, readFields } = fixture({
    event: [{ id: "missing-hash" }],
    scheduled: [
      {
        id: scheduledId(0),
        fields: {
          name: "n".repeat(129),
          failedReason: oversized,
          atm: "not-a-count",
        },
      },
      {
        id: scheduledId(1),
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

test("classifies only installed Medusa schedule IDs from bounded data", async () => {
  const oversizedId = scheduledId(3)
  const notScheduleId = scheduledId(6)
  const scheduled = [
    {
      id: scheduledId(0),
      fields: {
        name: "schedule",
        data: JSON.stringify({
          jobId: "job-sync-taxrate-io-quota",
          schedulerOptions: { cron: "*/5 * * * *" },
        }),
        atm: "2",
      },
    },
    {
      id: scheduledId(1),
      fields: {
        name: "schedule",
        data: JSON.stringify({ jobId: "private-unknown-task" }),
        atm: "1",
      },
    },
    { id: scheduledId(2), fields: { name: "schedule", atm: "1" } },
    {
      id: oversizedId,
      fields: { name: "schedule", data: "private".repeat(150), atm: "1" },
    },
    {
      id: scheduledId(4),
      fields: { name: "schedule", data: "{private", atm: "1" },
    },
    {
      id: scheduledId(5),
      fields: { name: "schedule", data: '{"jobId":42}', atm: "1" },
    },
    {
      id: notScheduleId,
      fields: {
        name: "private-other-kind",
        data: JSON.stringify({ jobId: "job-sync-taxrate-io-quota" }),
        atm: "1",
      },
    },
  ]
  const { client, valueReads } = fixture({ scheduled })
  const result = await classifyIsolatedFailedJobs({
    client,
    expectedFailed: { eventBus: 0, scheduledJobs: scheduled.length },
  })
  const { names, attempts } = result.queues.scheduledJobs
  assert.equal(names["sync-taxrate-io-quota"], 1)
  assert.equal(names.unlisted, 2)
  assert.equal(names.missingData, 1)
  assert.equal(names.oversizedData, 1)
  assert.equal(names.invalidData, 2)
  assert.equal(attempts.one, 6)
  assert.equal(attempts.multiple, 1)
  assert.equal(
    valueReads.some(
      ([key, field]) =>
        field === "data" &&
        (key.endsWith(`:${oversizedId}`) || key.endsWith(`:${notScheduleId}`))
    ),
    false
  )
  assert.doesNotMatch(JSON.stringify(result), /private|unknown-task/u)
})

test("fails closed on data-length drift and aggregate data cap", async () => {
  const one = fixture({
    scheduled: [
      {
        id: scheduledId(0),
        fields: {
          name: "schedule",
          data: '{"jobId":"job-sync-taxrate-io-quota"}',
          atm: "1",
        },
      },
    ],
  }).client
  const originalHStrLen = one.hStrLen
  one.hStrLen = async (key, field) =>
    field === "data" ? 1 : originalHStrLen(key, field)
  await assert.rejects(
    classifyIsolatedFailedJobs({
      client: one,
      expectedFailed: { eventBus: 0, scheduledJobs: 1 },
    }),
    { message: "Redis failed-job classification unavailable." }
  )

  const many = Array.from({ length: 300 }, (_, index) => ({
    id: scheduledId(index),
    fields: {
      name: "schedule",
      data: JSON.stringify({
        jobId: "job-sync-taxrate-io-quota",
        padding: "private".repeat(130),
      }),
      atm: "1",
    },
  }))
  await assert.rejects(
    classifyIsolatedFailedJobs({
      client: fixture({ scheduled: many }).client,
      expectedFailed: { eventBus: 0, scheduledJobs: many.length },
    }),
    { message: "Redis failed-job classification unavailable." }
  )
})

test("fails closed on count drift, duplicate or malformed IDs, wrong type, and deadline", async () => {
  const base = fixture({
    event: [
      {
        id: "event-a",
        fields: { name: "x", failedReason: "x", atm: "1" },
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
