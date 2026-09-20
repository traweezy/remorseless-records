import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import {
  parseLiveAggregateArguments,
  runLiveAggregateCli,
  runLiveAggregateRemote,
  validateLiveAggregate,
} from "./redis-live-queue-aggregate.mjs"

const ids = {
  projectId: "11111111-1111-4111-8111-111111111111",
  environmentId: "22222222-2222-4222-8222-222222222222",
  serviceId: "33333333-3333-4333-8333-333333333333",
  deploymentId: "44444444-4444-4444-8444-444444444444",
  instanceId: "55555555-5555-4555-8555-555555555555",
  volumeId: "66666666-6666-4666-8666-666666666666",
  volumeInstanceId: "77777777-7777-4777-8777-777777777777",
}
const scope = { ...ids, mountPath: "/bitnami" }
const flags = Object.entries(ids).flatMap(([name, value]) => [
  `--${name.replaceAll(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`,
  value,
])
const args = [...flags, "--expected-run-id-sha256", "a".repeat(64)]
const categoryNames = [
  "eventBus",
  "workflows",
  "scheduledJobs",
  "cleaner",
  "medusaLocks",
  "workflowCheckpointLocks",
  "workflowCheckpoints",
  "cartIdempotencyLocks",
  "cartIdempotencyResults",
  "healthSnapshots",
  "rateLimits",
  "other",
]
const queueNames = ["eventBus", "workflows", "scheduledJobs", "cleaner"]
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
const zero = (names) => Object.fromEntries(names.map((name) => [name, 0]))
const emptyAggregate = () => ({
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
const status = () => ({
  id: ids.projectId,
  environments: {
    edges: [
      {
        node: {
          id: ids.environmentId,
          name: "staging",
          serviceInstances: {
            edges: [
              {
                node: {
                  serviceId: ids.serviceId,
                  serviceName: "Redis",
                  activeDeployments: [
                    {
                      id: ids.deploymentId,
                      instances: [{ id: ids.instanceId, status: "RUNNING" }],
                    },
                  ],
                },
              },
            ],
          },
          volumeInstances: {
            edges: [
              {
                node: {
                  id: ids.volumeInstanceId,
                  serviceId: ids.serviceId,
                  environmentId: ids.environmentId,
                  volume: { id: ids.volumeId },
                  mountPath: "/bitnami",
                  state: "READY",
                  isPendingDeletion: false,
                },
              },
            ],
          },
        },
      },
    ],
  },
})

test("arguments pin all seven source IDs and an expected run-ID SHA", () => {
  assert.deepEqual(parseLiveAggregateArguments(args), {
    mode: "aggregate",
    scope,
    runIdSha256: "a".repeat(64),
  })
  assert.deepEqual(parseLiveAggregateArguments(["--help"]), { mode: "help" })
  for (const invalid of [
    args.slice(0, -2),
    [...args.slice(0, -1), "not-a-hash"],
    [...args, "--service-id", ids.serviceId],
    ["--project-id", "$(touch /tmp/unsafe)", ...args.slice(2)],
    [...args.slice(0, 1), "not-a-uuid", ...args.slice(2)],
  ])
    assert.throws(() => parseLiveAggregateArguments(invalid))
})

test("standalone help and invalid input make no Railway request", () => {
  const script = fileURLToPath(
    new URL("./redis-live-queue-aggregate.mjs", import.meta.url)
  )
  const help = spawnSync(process.execPath, [script, "--help"], {
    encoding: "utf8",
    timeout: 3_000,
  })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /expected-run-id-sha256/u)
  assert.equal(help.stderr, "")
  const invalid = spawnSync(process.execPath, [script, "--invalid"], {
    encoding: "utf8",
    timeout: 3_000,
  })
  assert.equal(invalid.status, 1)
  assert.equal(invalid.stdout, "")
  assert.equal(JSON.parse(invalid.stderr).reason, "aggregate_unavailable")
})

test("aggregate validation accepts fixed counts and rejects key or schema leakage", () => {
  const valid = emptyAggregate()
  valid.scannedKeys = 1
  valid.categories.scheduledJobs.count = 1
  valid.categories.scheduledJobs.types.zset = 1
  valid.categories.scheduledJobs.ttl.persistent = 1
  valid.queues.scheduledJobs.keyCount = 1
  valid.queues.scheduledJobs.states.failed = 237
  assert.deepEqual(validateLiveAggregate(valid), valid)
  for (const mutate of [
    (value) => {
      value.keys = ["secret:order-id"]
    },
    (value) => {
      value.categories.other.keyNames = ["secret"]
    },
    (value) => {
      value.scannedKeys = 5001
    },
    (value) => {
      value.categories.other.ttl.persistent = 1
    },
    (value) => {
      value.queues.scheduledJobs.keyCount = 2
    },
    (value) => {
      value.queues.scheduledJobs.states.failed = 1_000_000_001
    },
  ]) {
    const broken = structuredClone(valid)
    mutate(broken)
    assert.throws(() => validateLiveAggregate(broken))
  }
})

test("host checks exact Railway source on both sides and publishes no IDs", async () => {
  const output = []
  const errors = []
  const calls = []
  const code = await runLiveAggregateCli({
    args,
    status: async () => {
      calls.push("status")
      return status()
    },
    remote: async (received, hash) => {
      calls.push("remote")
      assert.deepEqual(received, scope)
      assert.equal(hash, "a".repeat(64))
      return emptyAggregate()
    },
    write: (line) => output.push(line),
    writeError: (line) => errors.push(line),
  })
  assert.equal(code, 0)
  assert.deepEqual(calls, ["status", "remote", "status"])
  assert.deepEqual(errors, [])
  assert.equal(JSON.parse(output[0]).queueReconciled, false)
  assert.match(JSON.parse(output[0]).observedAtStart, /^\d{4}-\d\d-\d\dT/u)
  assert.match(JSON.parse(output[0]).observedAtEnd, /^\d{4}-\d\d-\d\dT/u)
  assert.ok(
    Date.parse(JSON.parse(output[0]).observedAtEnd) >=
      Date.parse(JSON.parse(output[0]).observedAtStart)
  )
  for (const id of Object.values(ids)) assert.ok(!output[0].includes(id))
  assert.ok(!output[0].includes("a".repeat(64)))
})

test("source drift suppresses aggregate output and remote work if precheck fails", async () => {
  for (const driftAt of [1, 2]) {
    const output = []
    const errors = []
    let checks = 0
    let remoteCalls = 0
    const code = await runLiveAggregateCli({
      args,
      status: async () => {
        checks += 1
        const value = status()
        if (checks === driftAt)
          value.environments.edges[0].node.serviceInstances.edges[0].node.activeDeployments[0].id =
            ids.projectId
        return value
      },
      remote: async () => {
        remoteCalls += 1
        return emptyAggregate()
      },
      write: (line) => output.push(line),
      writeError: (line) => errors.push(line),
    })
    assert.equal(code, 1)
    assert.deepEqual(output, [])
    assert.equal(remoteCalls, driftAt === 1 ? 0 : 1)
    assert.equal(JSON.parse(errors[0]).reason, "aggregate_unavailable")
  }
})

test("SSH transport sends checked-in helper and rejects extra or sensitive output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "redis-live-aggregate-test-"))
  const command = join(directory, "railway")
  const report = JSON.stringify(emptyAggregate())
  try {
    await writeFile(
      command,
      `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
if (args[0] !== 'ssh' || args[9] !== '--' || args[10] !== 'perl' || args[11] !== '-') process.exit(2)
const request = JSON.parse(Buffer.from(args[12], 'base64').toString())
const source = fs.readFileSync(0, 'utf8')
if (request.runIdSha256 !== '${"a".repeat(64)}' || !source.includes('sub redis {')) process.exit(3)
process.stdout.write(process.env.RR_FAKE_OUTPUT)
`
    )
    await chmod(command, 0o700)
    const prior = process.env.RR_FAKE_OUTPUT
    try {
      process.env.RR_FAKE_OUTPUT = `${report}\n`
      assert.deepEqual(
        await runLiveAggregateRemote(scope, "a".repeat(64), { command }),
        emptyAggregate()
      )
      for (const bad of [
        `${report}\n${report}\n`,
        "secret:order-id\n",
        "x".repeat(20_000),
      ]) {
        process.env.RR_FAKE_OUTPUT = bad
        await assert.rejects(
          runLiveAggregateRemote(scope, "a".repeat(64), { command })
        )
      }
    } finally {
      if (prior === undefined) delete process.env.RR_FAKE_OUTPUT
      else process.env.RR_FAKE_OUTPUT = prior
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("malformed output reaps a TERM-ignoring CLI and its child process", {
  skip: process.platform !== "linux",
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "redis-live-aggregate-reap-"))
  const command = join(directory, "railway")
  const pidFile = join(directory, "pids.json")
  const prior = process.env.RR_FAKE_PIDS
  try {
    await writeFile(
      command,
      `#!/usr/bin/env node
const fs = require('node:fs')
const {spawn} = require('node:child_process')
process.on('SIGTERM', () => {})
const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], {stdio:'ignore'})
fs.writeFileSync(process.env.RR_FAKE_PIDS, JSON.stringify([process.pid, child.pid]))
process.stdout.write('x'.repeat(20000))
setInterval(() => {}, 1000)
`
    )
    await chmod(command, 0o700)
    process.env.RR_FAKE_PIDS = pidFile
    const started = Date.now()
    await assert.rejects(
      runLiveAggregateRemote(scope, "a".repeat(64), { command }),
      { message: "Live Redis aggregate unavailable." }
    )
    assert.ok(Date.now() - started < 7_000)
    const pids = JSON.parse(await readFile(pidFile, "utf8"))
    for (const pid of pids) {
      let stopped = false
      for (let attempt = 0; attempt < 15; attempt += 1) {
        try {
          const stat = await readFile(`/proc/${pid}/stat`, "utf8")
          stopped = stat.split(") ")[1]?.startsWith("Z") ?? false
        } catch (error) {
          if (error?.code === "ENOENT") stopped = true
          else throw error
        }
        if (stopped) break
        await delay(100)
      }
      assert.equal(stopped, true, `process ${pid} survived cleanup`)
    }
  } finally {
    if (prior === undefined) delete process.env.RR_FAKE_PIDS
    else process.env.RR_FAKE_PIDS = prior
    await rm(directory, { recursive: true, force: true })
  }
})
