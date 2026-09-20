import { createRequire } from "node:module"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

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
const redisLoaderPath = require.resolve(
  "@medusajs/workflow-engine-redis/dist/loaders/redis.js",
  { paths: [backendPath] }
)
const workflowRequire = createRequire(storagePath)
const eventBusRequire = createRequire(
  require.resolve("@medusajs/event-bus-redis/package.json", {
    paths: [backendPath],
  })
)
const workflowBullmqPath = workflowRequire.resolve("bullmq/package.json")
const eventBullmqPath = eventBusRequire.resolve("bullmq/package.json")
const bullmqRoot = dirname(workflowBullmqPath)
const [
  source,
  jobLoader,
  redisLoader,
  bullmqPackage,
  eventBullmqPackage,
  jobSource,
  finishedSource,
] = await Promise.all([
  readFile(storagePath, "utf8"),
  readFile(jobLoaderPath, "utf8"),
  readFile(redisLoaderPath, "utf8"),
  readFile(workflowBullmqPath, "utf8"),
  readFile(eventBullmqPath, "utf8"),
  readFile(join(bullmqRoot, "dist/cjs/classes/job.js"), "utf8"),
  readFile(join(bullmqRoot, "dist/cjs/scripts/moveToFinished-14.js"), "utf8"),
])
const correctedTimestamp =
  "const scheduledFor = new Date(job.opts.prevMillis ?? job.timestamp + job.delay);"
const enqueueTimestamp = "const scheduledFor = new Date(job.timestamp);"
const delayOnlyTimestamp =
  "const scheduledFor = new Date(job.timestamp + job.delay);"

if (
  !source.includes(correctedTimestamp) ||
  source.includes(enqueueTimestamp) ||
  source.includes(delayOnlyTimestamp)
) {
  throw new Error(
    "The Redis workflow worker must report BullMQ's delayed execution timestamp."
  )
}

console.log("✓ Redis workflow jobs report their delayed execution timestamp")

if (
  JSON.parse(bullmqPackage).version !== "5.13.0" ||
  JSON.parse(eventBullmqPackage).version !== "5.13.0" ||
  !jobLoader.includes("const workflowName = `job-${config.name}`;") ||
  !redisLoader.includes(
    'const jobQueueName_ = jobQueueName ?? "medusa-workflows-jobs";'
  ) ||
  !source.includes('JobType["SCHEDULE"] = "schedule";') ||
  !/this\.jobQueue\?\.add\(JobType\.SCHEDULE,\s*\{\s*jobId,\s*schedulerOptions,\s*\}/u.test(
    source
  ) ||
  !source.includes(
    "return await this.executeScheduledJob(job.data.jobId, job.data.schedulerOptions, scheduledFor);"
  ) ||
  !jobSource.includes(
    "job.attemptsMade = parseInt(json.attemptsMade || json.atm || '0');"
  ) ||
  !finishedSource.includes(
    'local attemptsMade = rcall("HINCRBY", jobIdKey, "atm", 1)'
  )
) {
  throw new Error(
    "Installed Medusa/BullMQ scheduled-job storage fields drifted from the offline recovery classifier."
  )
}

console.log(
  "✓ Installed scheduler job ID and BullMQ attempt fields match recovery triage"
)
