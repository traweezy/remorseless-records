import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { runInNewContext } from "node:vm"

const require = createRequire(import.meta.url)
const backendPath = fileURLToPath(new URL("../backend/", import.meta.url))
const storagePath = require.resolve(
  "@medusajs/workflow-engine-redis/dist/utils/workflow-orchestrator-storage.js",
  { paths: [backendPath] }
)
const jobLoaderPath = join(
  dirname(require.resolve("@medusajs/framework", { paths: [backendPath] })),
  "jobs/job-loader.js"
)

const loadInstalledModule = async (path, overrides) => {
  const source = await readFile(path, "utf8")
  const module = { exports: {} }
  const localRequire = createRequire(path)
  const fakeRequire = (specifier) =>
    Object.hasOwn(overrides, specifier)
      ? overrides[specifier]
      : localRequire(specifier)
  const factory = runInNewContext(
    `(function(require, module, exports) { ${source}\n})`,
    { Buffer, Date, Promise, clearTimeout, console, process, setTimeout },
    { filename: path, timeout: 2_000 }
  )
  factory(fakeRequire, module, module.exports)
  return module.exports
}

test("installed Redis worker hashes IDs and bounds failure output", async () => {
  const workers = new Map()
  class FakeUnrecoverableError extends Error {
    name = "UnrecoverableError"
  }
  class FakeQueue {
    async add() {}
  }
  class FakeWorker {
    constructor(name, processor) {
      workers.set(name, processor)
    }
  }
  const { RedisDistributedTransactionStorage } = await loadInstalledModule(
    storagePath,
    {
      bullmq: {
        Queue: FakeQueue,
        Worker: FakeWorker,
        UnrecoverableError: FakeUnrecoverableError,
      },
    }
  )
  const storage = new RedisDistributedTransactionStorage({
    workflowExecutionService: {},
    redisConnection: { status: "ready" },
    redisWorkerConnection: { status: "ready" },
    redisQueueName: "main",
    redisJobQueueName: "scheduled",
    logger: { debug() {}, error() {}, info() {}, warn() {} },
    isWorkerMode: true,
  })
  storage.removeAllRepeatableJobs = async () => {}
  const calls = []
  storage.setWorkflowOrchestratorService({
    run: async (name, options) => {
      calls.push({ name, options })
    },
  })
  await storage.onApplicationStart()
  const processScheduled = workers.get("scheduled")
  assert.equal(typeof processScheduled, "function")
  const scheduledFor = 1_790_000_000_000
  const base = {
    data: { jobId: "job-fixture", schedulerOptions: {} },
    opts: { prevMillis: scheduledFor },
    timestamp: scheduledFor - 1_000,
    delay: 1_000,
  }
  const id = `repeat:schedule_job-fixture:${scheduledFor}`
  await processScheduled({ ...base, id })
  await processScheduled({ ...base, id: undefined })
  await processScheduled({ ...base, id: "unsafe/id" })
  assert.equal(calls.length, 3)
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), {
    name: "job-fixture",
    options: {
      logOnError: false,
      input: {
        scheduledFor: new Date(scheduledFor).toISOString(),
        bullJobIdSha256: createHash("sha256").update(id).digest("hex"),
      },
    },
  })
  for (const call of calls.slice(1)) {
    assert.equal(call.options.input.bullJobIdSha256, undefined)
  }
  assert.equal(JSON.stringify(calls).includes(id), false)

  for (const original of [
    new Error("private@example.com"),
    new FakeUnrecoverableError("private@example.com"),
  ]) {
    storage.setWorkflowOrchestratorService({
      run: async (_name, options) => {
        assert.equal(options.logOnError, false)
        throw original
      },
    })
    await assert.rejects(processScheduled({ ...base, id }), (reported) => {
      assert.notEqual(reported, original)
      assert.equal(reported.message, "Scheduled job failed")
      assert.equal(
        reported instanceof FakeUnrecoverableError,
        original instanceof FakeUnrecoverableError
      )
      assert.equal(reported.message.includes(original.message), false)
      assert.equal(reported.stack.includes(original.message), false)
      // BullMQ persists these two fields as failedReason and stacktrace.
      assert.equal(
        JSON.stringify({
          failedReason: reported.message,
          stacktrace: [reported.stack],
        }).includes(original.message),
        false
      )
      return true
    })
  }
})

test("installed job loader passes the digest and redacts handler failures", async () => {
  let stepExecutor
  const observed = []
  const errors = []
  let failure
  const { JobLoader } = await loadInstalledModule(jobLoaderPath, {
    "@medusajs/utils": {
      isObject: () => false,
      registerDevServerResource: () => {},
    },
    "@medusajs/workflows-sdk": {
      createStep: (_name, executor) => {
        stepExecutor = executor
        return () => undefined
      },
      createWorkflow: () => {},
      StepResponse: class {},
      WorkflowResponse: class {},
    },
  })
  const loader = Object.create(JobLoader.prototype)
  loader.logger = { error: (message) => errors.push(message) }
  loader.register({
    path: "fixture",
    config: { name: "fixture", schedule: "* * * * *" },
    handler: async (_container, context) => {
      if (failure) throw failure
      observed.push(context)
    },
  })
  assert.equal(typeof stepExecutor, "function")
  const digest = createHash("sha256").update("fixture").digest("hex")
  await stepExecutor(
    { scheduledFor: "2026-01-01T00:00:00.000Z", bullJobIdSha256: digest },
    { container: {} }
  )
  await stepExecutor(
    { scheduledFor: "2026-01-01T00:00:00.000Z" },
    {
      container: {},
    }
  )
  assert.equal(observed.length, 2)
  assert.equal(observed[0].bullJobIdSha256, digest)
  assert.equal(observed[1].bullJobIdSha256, undefined)
  assert.equal(
    observed[0].scheduledFor.toISOString(),
    "2026-01-01T00:00:00.000Z"
  )

  failure = new Error("private@example.com")
  await assert.rejects(
    stepExecutor(
      { scheduledFor: "2026-01-01T00:00:00.000Z" },
      { container: {} }
    ),
    (error) => error === failure
  )
  assert.deepEqual(errors, ["Scheduled job failed"])
  assert.equal(JSON.stringify(errors).includes(failure.message), false)
})
