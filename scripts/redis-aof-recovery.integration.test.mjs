import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import {
  parseAofManifest,
  verifyRedisAofArchive,
} from "./lib/redis-aof-recovery.mjs"
import { runIntegrationCommand } from "./run-disposable-integration.mjs"
import { runIsolatedRedisReplay } from "./redis-aof-isolated-replay.mjs"
import { collectRedisQueueAggregate } from "./lib/redis-queue-aggregate.mjs"
import { classifyIsolatedFailedJobs } from "./lib/redis-failed-job-classifier.mjs"
import { inspectRedisQueueIntegrity } from "./lib/redis-queue-integrity.mjs"

const imageTag = "remorseless-records-integration-redis:8.10.1-hardened"
const imageIdPattern = /^(?:sha256:)?[a-f0-9]{64}$/u
const containerIdPattern = /^[a-f0-9]{64}$/u
const fixtureEnvironment = process.env
const backendRequire = createRequire(
  new URL("../backend/package.json", import.meta.url)
)
const eventBusRequire = createRequire(
  backendRequire.resolve("@medusajs/event-bus-redis/package.json")
)
const { Queue, Worker } = eventBusRequire("bullmq")
const workflowRequire = createRequire(
  backendRequire.resolve("@medusajs/workflow-engine-redis/package.json")
)
const { Queue: ScheduledQueue, Worker: ScheduledWorker } =
  workflowRequire("bullmq")
const { createClient } = backendRequire("redis")
const eventBusQueuePrefix = "RedisEventBusService"

const aggregateForSocket = async (path) => {
  const client = createClient({
    socket: { path, connectTimeout: 1_000, reconnectStrategy: false },
    disableOfflineQueue: true,
  })
  client.on("error", () => undefined)
  try {
    await client.connect()
    return await collectRedisQueueAggregate({ client })
  } finally {
    client.destroy()
  }
}

const failedJobsForSocket = async (path, expectedFailed) => {
  const client = createClient({
    socket: { path, connectTimeout: 1_000, reconnectStrategy: false },
    disableOfflineQueue: true,
  })
  client.on("error", () => undefined)
  try {
    await client.connect()
    return await classifyIsolatedFailedJobs({ client, expectedFailed })
  } finally {
    client.destroy()
  }
}

const pinnedImageId = async () => {
  const imageId = await runIntegrationCommand(
    "docker",
    ["image", "inspect", "--format", "{{.Id}}", imageTag],
    { capture: true, timeoutMs: 15_000 }
  )
  assert.match(imageId, imageIdPattern)
  if (fixtureEnvironment.RR_INTEGRATION_REDIS_IMAGE_ID)
    assert.equal(imageId, fixtureEnvironment.RR_INTEGRATION_REDIS_IMAGE_ID)
  return imageId
}

const checkerForImage = async (directory, imageId, uid, gid) => {
  const checker = join(directory, "redis-check-aof")
  await writeFile(
    checker,
    `#!/bin/sh
set -eu
if [ "$1" = "--version" ]; then
  exec docker --context default run --rm --pull never --network none --read-only --cap-drop ALL --security-opt no-new-privileges --memory 256m --pids-limit 64 --user ${uid}:${gid} --entrypoint redis-check-aof ${imageId} --version
fi
[ "$#" -eq 1 ]
exec docker --context default run --rm --pull never --network none --read-only --cap-drop ALL --security-opt no-new-privileges --memory 256m --pids-limit 64 --user ${uid}:${gid} --mount "type=bind,source=$(dirname "$1"),target=/aof" --entrypoint redis-check-aof ${imageId} /aof/appendonly.aof.manifest
`,
    { mode: 0o700 }
  )
  return {
    checker,
    checkerSha256: createHash("sha256")
      .update(await readFile(checker))
      .digest("hex"),
  }
}

test("the pinned checker validates an isolated synthetic multipart AOF", async () => {
  assert.equal(fixtureEnvironment.INTEGRATION_TESTS_ENABLED, "1")
  assert.equal(typeof process.getuid, "function")
  const uid = process.getuid()
  const gid = process.getgid()
  const imageId = await pinnedImageId()

  const archive = await mkdtemp(join(tmpdir(), "redis-aof-real-"))
  const tools = await mkdtemp(join(tmpdir(), "redis-aof-checker-"))
  try {
    const producer = `
set -eu
redis-server --daemonize yes --port 0 --unixsocket /data/redis.sock --unixsocketperm 700 --pidfile /data/redis.pid --dir /data --save '' --appendonly yes --appendfilename appendonly.aof --appenddirname appendonlydir --auto-aof-rewrite-percentage 0 --aof-use-rdb-preamble yes --logfile /data/redis.log
socket_ready=0
for attempt in $(seq 1 100); do
  if redis-cli -s /data/redis.sock PING >/dev/null 2>&1; then socket_ready=1; break; fi
  sleep 0.1
done
[ "$socket_ready" -eq 1 ]
redis-cli -s /data/redis.sock SET synthetic:base durable >/dev/null
redis-cli -s /data/redis.sock BGREWRITEAOF >/dev/null
ready=0
for attempt in $(seq 1 100); do
  persistence=$(redis-cli -s /data/redis.sock INFO persistence)
  if printf '%s' "$persistence" | grep -q 'aof_rewrite_in_progress:0' && printf '%s' "$persistence" | grep -q 'aof_last_bgrewrite_status:ok' && ls /data/appendonlydir/*.base.rdb >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.1
done
[ "$ready" -eq 1 ]
redis-cli -s /data/redis.sock SET synthetic:increment durable >/dev/null
redis-cli -s /data/redis.sock SHUTDOWN NOSAVE >/dev/null
cp /data/appendonlydir/appendonly.aof.* /artifact/
chmod 600 /artifact/*
`
    await runIntegrationCommand(
      "docker",
      [
        "run",
        "--rm",
        "--pull",
        "never",
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--memory",
        "256m",
        "--pids-limit",
        "64",
        "--user",
        `${uid}:${gid}`,
        "--tmpfs",
        `/data:rw,nosuid,nodev,size=32m,mode=0700,uid=${uid},gid=${gid}`,
        "--mount",
        `type=bind,source=${archive},target=/artifact`,
        "--entrypoint",
        "/bin/sh",
        imageId,
        "-ec",
        producer,
      ],
      { capture: true, timeoutMs: 45_000 }
    )

    const { checker, checkerSha256 } = await checkerForImage(
      tools,
      imageId,
      uid,
      gid
    )
    const report = await verifyRedisAofArchive({
      sourceDirectory: archive,
      checker,
      checkerSha256,
      maxBytes: 32 * 1024 * 1024,
    })
    assert.equal(report.status, "verified")
    assert.match(report.checkerVersion, /^redis-check-aof v=8\.10\.1 /u)
    assert.equal(report.replayProven, false)
    assert.ok(report.totalBytes > 0)
    assert.ok(report.fileCount >= 3)

    const capturedFiles = await Promise.all(
      (await readdir(archive))
        .sort((left, right) =>
          left === "appendonly.aof.manifest"
            ? -1
            : right === "appendonly.aof.manifest"
              ? 1
              : left.localeCompare(right)
        )
        .map(async (name) => {
          const bytes = await readFile(join(archive, name))
          return {
            name,
            bytes: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          }
        })
    )
    const receipt = {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      source: {
        projectId: "11111111-1111-4111-8111-111111111111",
        environmentId: "22222222-2222-4222-8222-222222222222",
        serviceId: "33333333-3333-4333-8333-333333333333",
        deploymentId: "44444444-4444-4444-8444-444444444444",
        instanceId: "55555555-5555-4555-8555-555555555555",
        volumeId: "66666666-6666-4666-8666-666666666666",
        volumeInstanceId: "77777777-7777-4777-8777-777777777777",
        mountPath: "/bitnami",
      },
      sourceFingerprint: "a".repeat(64),
      runIdSha256: "b".repeat(64),
      manifestSha256: capturedFiles[0].sha256,
      files: capturedFiles,
      totalBytes: capturedFiles.reduce((sum, file) => sum + file.bytes, 0),
      rewriteRestored: true,
    }
    const receiptPath = join(tools, "capture.receipt.json")
    const receiptBytes = Buffer.from(`${JSON.stringify(receipt)}\n`)
    await writeFile(receiptPath, receiptBytes, { mode: 0o600 })
    const replayOutput = []
    assert.equal(
      await runIsolatedRedisReplay({
        // The CI fixture builds this scanned image from the pinned base but
        // does not provision the named official image for the wrapper.
        // Exercise receipt-bound replay with its separately verified checker.
        verify: ({ sourceDirectory, maxBytes, signal }) =>
          verifyRedisAofArchive({
            sourceDirectory,
            checker,
            checkerSha256,
            maxBytes,
            signal,
          }),
        args: [
          "--archive-dir",
          archive,
          "--capture-receipt",
          receiptPath,
          "--receipt-sha256",
          createHash("sha256").update(receiptBytes).digest("hex"),
          "--image-id",
          imageId,
          "--classify-failed-jobs",
          "--inspect-queue-integrity",
        ],
        write: (line) => replayOutput.push(line),
        writeError: (line) => replayOutput.push(line),
      }),
      0,
      replayOutput.join("")
    )
    const replay = JSON.parse(replayOutput[0])
    assert.equal(replay.startupProven, true)
    assert.equal(replay.restartProven, true)
    assert.equal(replay.keyCount, 2)
    assert.equal(replay.aggregateStartup.scannedKeys, 2)
    assert.deepEqual(replay.aggregateRestart, replay.aggregateStartup)
    assert.equal(replay.aggregateRestart.categories.other.count, 2)
    assert.equal(replay.failedJobs.totalFailed, 0)
    assert.equal(replay.failedJobs.queueReconciled, false)
    assert.equal(replay.queueIntegrity.total.members, 0)
    assert.equal(replay.queueIntegrity.queueReconciled, false)
    assert.doesNotMatch(replayOutput[0], /event-failed|synthetic-failure/u)
    assert.doesNotMatch(replayOutput[0], /synthetic:base|synthetic:increment/u)
    assert.equal(replay.queueReconciled, false)
    assert.equal(replay.businessReconciled, false)
    for (const file of capturedFiles)
      assert.equal(
        createHash("sha256")
          .update(await readFile(join(archive, file.name)))
          .digest("hex"),
        file.sha256
      )

    const manifestPath = join(archive, "appendonly.aof.manifest")
    const entries = parseAofManifest(await readFile(manifestPath, "utf8"))
    assert.equal(entries.filter(({ type }) => type === "b").length, 1)
    for (const { name, type } of entries) {
      if (type !== "b") await unlink(join(archive, name))
    }
    const baseLine = (await readFile(manifestPath, "utf8"))
      .split("\n")
      .find((line) => line.endsWith("type b"))
    assert.ok(baseLine)
    await writeFile(manifestPath, `${baseLine}\n`)
    const baseOnly = await verifyRedisAofArchive({
      sourceDirectory: archive,
      checker,
      checkerSha256,
      maxBytes: 32 * 1024 * 1024,
    })
    assert.equal(baseOnly.activeFileCount, 1)
    assert.equal(baseOnly.historyFileCount, 0)
    assert.equal(baseOnly.fileCount, 2)

    const base = entries.find(({ type }) => type === "b")
    const historySequence =
      base.sequence > 1 ? base.sequence - 1 : base.sequence + 1
    const historyName = `appendonly.aof.${historySequence}.base.rdb`
    await writeFile(
      join(archive, historyName),
      await readFile(join(archive, base.name)),
      { mode: 0o600 }
    )
    await writeFile(
      manifestPath,
      `${baseLine}\nfile ${historyName} seq ${historySequence} type h\n`
    )
    const withHistory = await verifyRedisAofArchive({
      sourceDirectory: archive,
      checker,
      checkerSha256,
      maxBytes: 32 * 1024 * 1024,
    })
    assert.equal(withHistory.activeFileCount, 1)
    assert.equal(withHistory.historyFileCount, 1)
    assert.equal(withHistory.fileCount, 3)
  } finally {
    await rm(tools, { recursive: true, force: true })
    await rm(archive, { recursive: true, force: true })
  }
})

const waitForFixture = async (phase, condition) => {
  const deadline = Date.now() + 15_000
  let commandFailed = false
  while (Date.now() < deadline) {
    const timer = new AbortController()
    try {
      const ready = await Promise.race([
        condition(),
        delay(deadline - Date.now(), false, { signal: timer.signal }),
      ])
      if (ready) return
    } catch {
      commandFailed = true
    } finally {
      timer.abort()
    }
    const remaining = deadline - Date.now()
    if (remaining > 0) await delay(Math.min(100, remaining))
  }
  assert.fail(
    `Disposable Redis ${phase} did not become ready within 15 seconds${commandFailed ? " after a probe failed" : ""}.`
  )
}

const isolatedServer = async ({
  data,
  socketDirectory,
  imageId,
  uid,
  gid,
  ownedContainers,
}) => {
  const id = await runIntegrationCommand(
    "docker",
    [
      "run",
      "--detach",
      "--pull",
      "never",
      "--network",
      "none",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--cpus",
      "1",
      "--memory",
      "256m",
      "--memory-swap",
      "256m",
      "--pids-limit",
      "64",
      "--user",
      `${uid}:${gid}`,
      "--mount",
      `type=bind,source=${data},target=/data`,
      "--mount",
      `type=bind,source=${socketDirectory},target=/socket`,
      "--entrypoint",
      "redis-server",
      imageId,
      "--port",
      "0",
      "--unixsocket",
      "/socket/redis.sock",
      "--unixsocketperm",
      "700",
      "--dir",
      "/data",
      "--appendonly",
      "yes",
      "--appendfilename",
      "appendonly.aof",
      "--appenddirname",
      "appendonlydir",
      "--appendfsync",
      "always",
      "--auto-aof-rewrite-percentage",
      "0",
      "--aof-use-rdb-preamble",
      "yes",
      "--aof-load-truncated",
      "no",
      "--save",
      "",
      "--maxmemory",
      "128mb",
      "--maxmemory-policy",
      "noeviction",
    ],
    { capture: true, timeoutMs: 15_000 }
  )
  assert.match(id, containerIdPattern)
  ownedContainers.push(id)
  const isolation = await runIntegrationCommand(
    "docker",
    [
      "inspect",
      "--format",
      "{{.HostConfig.NetworkMode}}|{{.HostConfig.ReadonlyRootfs}}|{{.HostConfig.Privileged}}",
      id,
    ],
    { capture: true, timeoutMs: 15_000 }
  )
  assert.equal(isolation, "none|true|false")
  await waitForFixture(
    "server",
    async () =>
      (await runIntegrationCommand(
        "docker",
        ["exec", id, "redis-cli", "-s", "/socket/redis.sock", "PING"],
        { capture: true, timeoutMs: 2_000 }
      )) === "PONG"
  )
  return id
}

const fixtureRedisCli = (id, args) =>
  runIntegrationCommand(
    "docker",
    ["exec", id, "redis-cli", "-s", "/socket/redis.sock", ...args],
    { capture: true, timeoutMs: 5_000 }
  )

const queueStates = [
  "waiting",
  "active",
  "delayed",
  "completed",
  "failed",
  "paused",
  "waiting-children",
]

const queueSnapshot = async (queue, jobIds) => {
  const counts = await queue.getJobCounts(...queueStates)
  const jobs = await Promise.all(
    jobIds.map(async (id) => {
      const job = await queue.getJob(id)
      return [id, job ? await job.getState() : "missing"]
    })
  )
  return {
    counts: Object.fromEntries(
      queueStates.map((state) => [state, counts[state] ?? 0])
    ),
    jobs: Object.fromEntries(jobs),
  }
}

test("an isolated Redis 8.10.1 startup replays synthetic BullMQ states from multipart AOF", {
  timeout: 120_000,
}, async () => {
  assert.equal(fixtureEnvironment.INTEGRATION_TESTS_ENABLED, "1")
  assert.equal(typeof process.getuid, "function")
  const eventBusSource = await readFile(
    eventBusRequire.resolve("./dist/services/event-bus-redis.js"),
    "utf8"
  )
  assert.ok(eventBusSource.includes("class RedisEventBusService extends"))
  assert.ok(eventBusSource.includes("prefix: `${this.constructor.name}`"))
  const uid = process.getuid()
  const gid = process.getgid()
  const imageId = await pinnedImageId()
  const sourceData = await mkdtemp(join(tmpdir(), "redis-aof-source-"))
  const sourceSocket = await mkdtemp(join(tmpdir(), "redis-aof-source-socket-"))
  const archive = await mkdtemp(join(tmpdir(), "redis-aof-queue-archive-"))
  const targetData = await mkdtemp(join(tmpdir(), "redis-aof-target-"))
  const targetSocket = await mkdtemp(join(tmpdir(), "redis-aof-target-socket-"))
  const tools = await mkdtemp(join(tmpdir(), "redis-aof-queue-checker-"))
  const ownedDirectories = [
    sourceData,
    sourceSocket,
    archive,
    targetData,
    targetSocket,
    tools,
  ]
  const ownedContainers = []
  let worker
  let scheduledWorker
  let eventQueue
  let workflowQueue
  let scheduledQueue
  let restoredEventQueue
  let restoredWorkflowQueue
  let restoredScheduledQueue
  let testFailure
  let scheduledEnvelopeObserved = false
  try {
    const sourceId = await isolatedServer({
      data: sourceData,
      socketDirectory: sourceSocket,
      imageId,
      uid,
      gid,
      ownedContainers,
    })
    const connection = {
      path: join(sourceSocket, "redis.sock"),
      connectTimeout: 1_000,
      maxRetriesPerRequest: null,
      retryStrategy: () => null,
    }
    eventQueue = new Queue("events-queue", {
      connection,
      prefix: eventBusQueuePrefix,
    })
    workflowQueue = new Queue("medusa-workflows", { connection })
    scheduledQueue = new ScheduledQueue("medusa-workflows-jobs", {
      connection,
    })
    assert.equal(eventQueue.qualifiedName, "RedisEventBusService:events-queue")
    assert.equal(workflowQueue.qualifiedName, "bull:medusa-workflows")
    assert.equal(scheduledQueue.qualifiedName, "bull:medusa-workflows-jobs")
    worker = new Worker(
      "events-queue",
      async (job) => {
        if (job.name === "synthetic-failure")
          throw new Error("Expected synthetic job failure")
        return "synthetic-complete"
      },
      { connection, concurrency: 1, prefix: eventBusQueuePrefix }
    )
    const workerErrors = []
    worker.on("error", () => workerErrors.push("worker_error"))
    await worker.waitUntilReady()
    await eventQueue.add(
      "synthetic-completion",
      { fixture: true },
      {
        jobId: "event-complete",
        removeOnComplete: false,
      }
    )
    await eventQueue.add(
      "synthetic-failure",
      { fixture: true },
      {
        jobId: "event-failed",
        removeOnFail: false,
      }
    )
    await waitForFixture("BullMQ jobs", async () => {
      const counts = await eventQueue.getJobCounts("completed", "failed")
      return counts.completed === 1 && counts.failed === 1
    })
    assert.deepEqual(workerErrors, [])
    await worker.close()
    worker = undefined

    scheduledWorker = new ScheduledWorker(
      "medusa-workflows-jobs",
      async (job) => {
        scheduledEnvelopeObserved =
          job.name === "schedule" &&
          job.data.jobId === "job-sync-taxrate-io-quota"
        throw new Error("Expected synthetic scheduled job failure")
      },
      { connection, concurrency: 1 }
    )
    scheduledWorker.on("error", () => workerErrors.push("worker_error"))
    await scheduledWorker.waitUntilReady()
    await scheduledQueue.add(
      "schedule",
      {
        jobId: "job-sync-taxrate-io-quota",
        schedulerOptions: { cron: "*/5 * * * *" },
      },
      {
        jobId: "scheduled-failed",
        removeOnFail: { age: 604800, count: 5000 },
      }
    )
    await waitForFixture("scheduled BullMQ failure", async () => {
      const counts = await scheduledQueue.getJobCounts("failed")
      return counts.failed === 1
    })
    assert.equal(scheduledEnvelopeObserved, true)
    assert.deepEqual(workerErrors, [])
    await scheduledWorker.close()
    scheduledWorker = undefined

    await fixtureRedisCli(sourceId, ["BGREWRITEAOF"])
    await waitForFixture("AOF rewrite", async () => {
      const info = await fixtureRedisCli(sourceId, ["INFO", "persistence"])
      const files = await readdir(join(sourceData, "appendonlydir"))
      return (
        /aof_rewrite_in_progress:0/u.test(info) &&
        /aof_last_bgrewrite_status:ok/u.test(info) &&
        files.some((name) => name.endsWith(".base.rdb"))
      )
    })

    await eventQueue.add(
      "synthetic-waiting",
      { fixture: true },
      {
        jobId: "event-waiting",
      }
    )
    await workflowQueue.add(
      "synthetic-waiting",
      { fixture: true },
      {
        jobId: "workflow-waiting",
      }
    )
    await workflowQueue.add(
      "synthetic-delayed",
      { fixture: true },
      {
        jobId: "workflow-delayed",
        delay: 30 * 60_000,
      }
    )
    assert.equal(
      await fixtureRedisCli(sourceId, [
        "SET",
        "synthetic:post-rewrite",
        "present",
      ]),
      "OK"
    )
    const ttlDeadline = Date.now() + 45 * 60_000
    assert.equal(
      await fixtureRedisCli(sourceId, [
        "SET",
        "synthetic:ttl",
        "present",
        "PXAT",
        String(ttlDeadline),
      ]),
      "OK"
    )
    assert.equal(
      Number(await fixtureRedisCli(sourceId, ["PEXPIRETIME", "synthetic:ttl"])),
      ttlDeadline
    )
    const eventIds = ["event-complete", "event-failed", "event-waiting"]
    const workflowIds = ["workflow-waiting", "workflow-delayed"]
    const scheduledIds = ["scheduled-failed"]
    const expected = {
      events: await queueSnapshot(eventQueue, eventIds),
      workflows: await queueSnapshot(workflowQueue, workflowIds),
      scheduled: await queueSnapshot(scheduledQueue, scheduledIds),
    }
    assert.equal(expected.events.counts.completed, 1)
    assert.equal(expected.events.counts.failed, 1)
    assert.equal(expected.events.counts.waiting, 1)
    assert.equal(expected.workflows.counts.waiting, 1)
    assert.equal(expected.workflows.counts.delayed, 1)
    assert.equal(expected.scheduled.counts.failed, 1)
    const sourceAggregate = await aggregateForSocket(connection.path)
    assert.equal(sourceAggregate.queues.eventBus.states.completed, 1)
    assert.equal(sourceAggregate.queues.eventBus.states.failed, 1)
    assert.equal(sourceAggregate.queues.eventBus.states.wait, 1)
    assert.equal(sourceAggregate.queues.workflows.states.wait, 1)
    assert.equal(sourceAggregate.queues.workflows.states.delayed, 1)
    assert.equal(sourceAggregate.queues.scheduledJobs.states.failed, 1)
    assert.doesNotMatch(JSON.stringify(sourceAggregate), /event-complete/u)
    assert.equal(
      await fixtureRedisCli(sourceId, [
        "TYPE",
        "RedisEventBusService:events-queue:completed",
      ]),
      "zset"
    )
    assert.equal(
      await fixtureRedisCli(sourceId, ["TYPE", "bull:events-queue:completed"]),
      "none"
    )
    await eventQueue.close()
    eventQueue = undefined
    await workflowQueue.close()
    workflowQueue = undefined
    await scheduledQueue.close()
    scheduledQueue = undefined
    await runIntegrationCommand("docker", ["stop", "--time", "5", sourceId], {
      capture: true,
      timeoutMs: 15_000,
    })

    const sourceAofDirectory = join(sourceData, "appendonlydir")
    const names = await readdir(sourceAofDirectory)
    assert.ok(names.length >= 3 && names.length <= 5)
    let totalBytes = 0
    for (const name of names) {
      const source = join(sourceAofDirectory, name)
      const details = await stat(source)
      assert.ok(details.isFile())
      totalBytes += details.size
      assert.ok(totalBytes <= 32 * 1024 * 1024)
      await copyFile(source, join(archive, name))
    }
    for (const name of names) await chmod(join(archive, name), 0o600)
    const sourceHashes = Object.fromEntries(
      await Promise.all(
        names.map(async (name) => [
          name,
          createHash("sha256")
            .update(await readFile(join(sourceAofDirectory, name)))
            .digest("hex"),
        ])
      )
    )
    const { checker, checkerSha256 } = await checkerForImage(
      tools,
      imageId,
      uid,
      gid
    )
    const verification = await verifyRedisAofArchive({
      sourceDirectory: archive,
      checker,
      checkerSha256,
      maxBytes: 32 * 1024 * 1024,
    })
    assert.equal(verification.status, "verified")
    assert.equal(verification.replayProven, false)
    assert.ok(verification.activeFileCount >= 2)

    const targetAofDirectory = join(targetData, "appendonlydir")
    await mkdir(targetAofDirectory, { mode: 0o700 })
    for (const name of names)
      await copyFile(join(archive, name), join(targetAofDirectory, name))
    const targetId = await isolatedServer({
      data: targetData,
      socketDirectory: targetSocket,
      imageId,
      uid,
      gid,
      ownedContainers,
    })
    const targetConnection = {
      ...connection,
      path: join(targetSocket, "redis.sock"),
    }
    restoredEventQueue = new Queue("events-queue", {
      connection: targetConnection,
      prefix: eventBusQueuePrefix,
    })
    restoredWorkflowQueue = new Queue("medusa-workflows", {
      connection: targetConnection,
    })
    restoredScheduledQueue = new ScheduledQueue("medusa-workflows-jobs", {
      connection: targetConnection,
    })
    const observed = {
      events: await queueSnapshot(restoredEventQueue, eventIds),
      workflows: await queueSnapshot(restoredWorkflowQueue, workflowIds),
      scheduled: await queueSnapshot(restoredScheduledQueue, scheduledIds),
    }
    assert.deepEqual(observed, expected)
    assert.deepEqual(
      await aggregateForSocket(targetConnection.path),
      sourceAggregate
    )
    const failedJobs = await failedJobsForSocket(targetConnection.path, {
      eventBus: 1,
      scheduledJobs: 1,
    })
    assert.equal(failedJobs.schemaVersion, 2)
    assert.equal(failedJobs.totalFailed, 2)
    assert.equal(failedJobs.queues.eventBus.names.unlisted, 1)
    assert.equal(failedJobs.queues.eventBus.reasons.other, 1)
    assert.equal(failedJobs.queues.eventBus.attempts.one, 1)
    assert.equal(
      failedJobs.queues.scheduledJobs.names["sync-taxrate-io-quota"],
      1
    )
    assert.equal(failedJobs.queues.scheduledJobs.attempts.one, 1)
    assert.equal(failedJobs.queueReconciled, false)
    const integrityClient = createClient({
      socket: {
        path: targetConnection.path,
        connectTimeout: 1_000,
        reconnectStrategy: false,
      },
      disableOfflineQueue: true,
    })
    integrityClient.on("error", () => undefined)
    try {
      await integrityClient.connect()
      const integrity = await inspectRedisQueueIntegrity({
        client: integrityClient,
        expectedQueues: (await aggregateForSocket(targetConnection.path))
          .queues,
        capturedAt: new Date().toISOString(),
      })
      assert.equal(integrity.total.members, 6)
      assert.equal(integrity.total.missingJobHash, 0)
      assert.equal(integrity.total.presentInMultipleStates, 0)
      assert.equal(integrity.queues.workflows.delayedAfterReceipt, 1)
      assert.equal(integrity.queueReconciled, false)
      assert.doesNotMatch(
        JSON.stringify(integrity),
        /event-failed|scheduled-failed|workflow-delayed/u
      )
    } finally {
      integrityClient.destroy()
    }
    assert.doesNotMatch(
      JSON.stringify(failedJobs),
      /event-failed|scheduled-failed|job-sync-taxrate-io-quota|synthetic-failure/u
    )
    assert.equal(
      await fixtureRedisCli(targetId, [
        "TYPE",
        "RedisEventBusService:events-queue:completed",
      ]),
      "zset"
    )
    assert.equal(
      await fixtureRedisCli(targetId, ["GET", "synthetic:post-rewrite"]),
      "present"
    )
    assert.equal(
      Number(await fixtureRedisCli(targetId, ["PEXPIRETIME", "synthetic:ttl"])),
      ttlDeadline
    )
    assert.match(
      await fixtureRedisCli(targetId, ["INFO", "server"]),
      /redis_version:8\.10\.1/u
    )
    assert.equal(
      await fixtureRedisCli(targetId, [
        "SET",
        "synthetic:target-only",
        "present",
      ]),
      "OK"
    )
    await restoredEventQueue.close()
    restoredEventQueue = undefined
    await restoredWorkflowQueue.close()
    restoredWorkflowQueue = undefined
    await restoredScheduledQueue.close()
    restoredScheduledQueue = undefined
    await runIntegrationCommand("docker", ["stop", "--time", "5", targetId], {
      capture: true,
      timeoutMs: 15_000,
    })
    const restartedId = await isolatedServer({
      data: targetData,
      socketDirectory: targetSocket,
      imageId,
      uid,
      gid,
      ownedContainers,
    })
    assert.equal(
      await fixtureRedisCli(restartedId, ["GET", "synthetic:target-only"]),
      "present"
    )
    assert.equal(
      Number(
        await fixtureRedisCli(restartedId, ["PEXPIRETIME", "synthetic:ttl"])
      ),
      ttlDeadline
    )
    restoredEventQueue = new Queue("events-queue", {
      connection: targetConnection,
      prefix: eventBusQueuePrefix,
    })
    restoredWorkflowQueue = new Queue("medusa-workflows", {
      connection: targetConnection,
    })
    restoredScheduledQueue = new ScheduledQueue("medusa-workflows-jobs", {
      connection: targetConnection,
    })
    assert.deepEqual(
      {
        events: await queueSnapshot(restoredEventQueue, eventIds),
        workflows: await queueSnapshot(restoredWorkflowQueue, workflowIds),
        scheduled: await queueSnapshot(restoredScheduledQueue, scheduledIds),
      },
      expected
    )
    for (const name of names) {
      assert.equal(
        createHash("sha256")
          .update(await readFile(join(sourceAofDirectory, name)))
          .digest("hex"),
        sourceHashes[name]
      )
      assert.equal(
        createHash("sha256")
          .update(await readFile(join(archive, name)))
          .digest("hex"),
        sourceHashes[name]
      )
    }
  } catch (error) {
    testFailure = error
  } finally {
    const clientCleanup = await Promise.allSettled([
      worker?.close(),
      scheduledWorker?.close(),
      eventQueue?.close(),
      workflowQueue?.close(),
      scheduledQueue?.close(),
      restoredEventQueue?.close(),
      restoredWorkflowQueue?.close(),
      restoredScheduledQueue?.close(),
    ])
    const cleanup = await Promise.allSettled(
      ownedContainers.map((id) =>
        runIntegrationCommand("docker", ["rm", "--force", id], {
          capture: true,
          timeoutMs: 15_000,
        })
      )
    )
    const directoryCleanup = await Promise.allSettled(
      ownedDirectories.map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    )
    const failedCount = [
      ...clientCleanup,
      ...cleanup,
      ...directoryCleanup,
    ].filter(({ status }) => status === "rejected").length
    if (failedCount > 0) {
      const cleanupError = new Error(
        `Disposable Redis fixture cleanup failed for ${failedCount} resources.`
      )
      if (testFailure)
        throw new AggregateError(
          [testFailure, cleanupError],
          "Disposable Redis fixture test and cleanup failed."
        )
      throw cleanupError
    }
  }
  if (testFailure) throw testFailure
})
