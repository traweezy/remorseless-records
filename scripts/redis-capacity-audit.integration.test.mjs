import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test, { after, before } from "node:test"
import {
  collectRedisAudit,
  parseRedisAuditEnvironment,
} from "./lib/redis-audit-client.mjs"
import { evaluateRedisCapacity } from "./lib/redis-capacity-audit.mjs"

const fixtureError = () =>
  new Error(
    "Redis audit integration requires the disposable local Redis fixture."
  )

const fixtureUrl = (environment) => {
  const raw = environment.REDIS_URL
  if (
    environment.INTEGRATION_TESTS_ENABLED !== "1" ||
    typeof raw !== "string" ||
    /[\s\u0000-\u001f\u007f]/u.test(raw) ||
    !/^redis:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::[1-9][0-9]{0,4})?(?:\/0?)?$/u.test(
      raw
    )
  )
    throw fixtureError()
  let url
  try {
    url = new URL(raw)
  } catch {
    throw fixtureError()
  }
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    !["", "/", "/0"].includes(url.pathname) ||
    url.search ||
    url.hash
  )
    throw fixtureError()
  return url.toString()
}

// Do not fall back to REDIS_AUDIT_URL or load an application .env file.
const url = fixtureUrl(process.env)
const config = parseRedisAuditEnvironment({
  REDIS_AUDIT_URL: url,
  REDIS_SERVICE_MEMORY_LIMIT_BYTES: "268435456",
  REDIS_AUDIT_TIMEOUT_MS: "5000",
})
const require = createRequire(
  new URL("../backend/package.json", import.meta.url)
)
const { createClient } = require("redis")
const configKeys = [
  "maxmemory",
  "maxmemory-policy",
  "appendonly",
  "appendfsync",
  "save",
  "no-appendfsync-on-rewrite",
]
const infoSections = [
  "server",
  "memory",
  "persistence",
  "stats",
  "replication",
  "keyspace",
]
const expectedCommands = [
  ["CONFIG", "GET", ...configKeys],
  ...infoSections.map((section) => ["INFO", section]),
]
const allowedCommands = new Set(expectedCommands.map(JSON.stringify))
const clients = []

const trackedFactory =
  (commands, beforeCommand = () => {}) =>
  (options) => {
    assert.equal(options.RESP, 2)
    assert.equal(options.disableClientInfo, true)
    const client = createClient(options)
    clients.push(client)
    // Expose no key, ACL, configuration-mutation, or enumeration methods. The
    // allowlist is independent of the implementation under test and fails before
    // dispatch; it covers audit commands, not the driver's connection handshake.
    const adapter = {
      get isOpen() {
        return client.isOpen
      },
      on: (event, listener) => {
        client.on(event, listener)
        return adapter
      },
      connect: () => client.connect(),
      sendCommand: (command, options) => {
        if (!allowedCommands.has(JSON.stringify(command)))
          throw new Error("Redis integration blocked an unapproved command.")
        commands.push([...command])
        beforeCommand()
        return client.sendCommand(command, options)
      },
      destroy: () => client.destroy(),
    }
    return adapter
  }

let observation
let report
const commands = []

before(async () => {
  observation = await collectRedisAudit({
    config,
    createClient: trackedFactory(commands),
  })
  assert.ok(
    /^redis_version:8\.10\.1\r?$/mu.test(observation.info.server),
    "Redis integration requires the pinned 8.10.1 fixture."
  )
  report = evaluateRedisCapacity({
    ...observation,
    memoryLimitBytes: config.memoryLimitBytes,
  })
})

after(() => {
  // A failing assertion must not leave this test's connection open.
  for (const client of clients) if (client.isOpen) client.destroy()
})

test("rejects unsafe integration endpoints before creating a Redis client", () => {
  for (const environment of [
    {},
    { INTEGRATION_TESTS_ENABLED: "0", REDIS_URL: "redis://127.0.0.1:6379" },
    ...[
      "redis://example.invalid:6379",
      "redis://redis.railway.internal:6379",
      "rediss://127.0.0.1:6379",
      "redis://127.0.0.1:6379/1",
      "redis://127.0.0.1:6379/00",
      "redis://127.0.0.1:6379/0/",
      "redis://127.0.0.1:6379?",
      "redis://127.0.0.1:6379#",
      "redis://127.0.0.1:6379?db=0",
      "redis://127.0.0.1:6379#fragment",
      "redis://user@127.0.0.1:6379",
      "redis://:fixture-only@127.0.0.1:6379",
      "redis://@127.0.0.1:6379",
      "redis://127.0.0.1:65536",
      "redis://127.0.0.1:0",
      "redis://127.0.0.1:6379\n",
      " redis://127.0.0.1:6379",
      "redis://127.0.0.1:6379/%30",
      "redis://0x7f000001:6379",
      "redis://localhost.invalid:6379",
    ].map((REDIS_URL) => ({ INTEGRATION_TESTS_ENABLED: "1", REDIS_URL })),
  ])
    assert.throws(() => fixtureUrl(environment), {
      message: fixtureError().message,
    })
})

test("accepts only explicit local default-database fixture forms", () => {
  for (const REDIS_URL of [
    "redis://127.0.0.1:6379",
    "redis://127.0.0.1:56379/0",
    "redis://localhost:56379/",
    "redis://[::1]:56379/0",
    "redis://localhost",
  ])
    assert.doesNotThrow(() =>
      fixtureUrl({ INTEGRATION_TESTS_ENABLED: "1", REDIS_URL })
    )
})

test("collects actual RESP2 CONFIG pairs and six INFO sections without enumerating keys", () => {
  assert.deepEqual(commands, expectedCommands)
  assert.equal(observation.config.length, configKeys.length * 2)
  assert.ok(observation.config.every((value) => typeof value === "string"))
  assert.deepEqual(
    observation.config.filter((_, index) => index % 2 === 0).sort(),
    [...configKeys].sort()
  )
  assert.deepEqual(
    Object.keys(observation.info).sort(),
    [...infoSections].sort()
  )
  assert.ok(
    Object.values(observation.info).every((value) => typeof value === "string")
  )
  assert.equal(clients.length, 1)
  assert.equal(clients[0].isOpen, false)
})

test("reports the disposable fixture as degraded rather than accepting disabled persistence", () => {
  assert.equal(report.schemaVersion, 1)
  assert.equal(report.status, "degraded")
  assert.ok(report.reasons.includes("aof_disabled"))
  assert.equal(report.persistence.aofEnabled, false)
  assert.equal(report.persistence.mode, "standalone")
  assert.equal(report.persistence.role, "master")
  assert.equal(report.memory.serviceLimitBytes, 268_435_456)
  assert.ok(Number.isSafeInteger(report.memory.usedBytes))
  assert.ok(report.memory.usedBytes > 0)
  assert.ok(Number.isSafeInteger(report.stats.keyCount))
  assert.ok(report.stats.expiringKeyCount <= report.stats.keyCount)
})

test("supports both bounded Compose and unbounded GitHub Redis fixture settings", () => {
  assert.ok([0, 67_108_864].includes(report.memory.maxmemoryBytes))
  if (report.memory.maxmemoryBytes === 0) {
    assert.ok(report.reasons.includes("maxmemory_unbounded"))
  } else {
    assert.equal(report.reasons.includes("maxmemory_unbounded"), false)
    assert.equal(report.persistence.rdbSaveRuleCount, 0)
    assert.ok(report.reasons.includes("rdb_schedule_disabled"))
  }
})

test("returns a redacted summary and discards private server and replication metadata", () => {
  const canary = "disposable-redis-private-metadata-canary"
  const augmented = {
    ...observation,
    info: {
      ...observation.info,
      server: `${observation.info.server}rr_private_path:/private/${canary}\r\n`,
      replication: `${observation.info.replication}rr_private_endpoint:redis://${canary}.invalid:6379\r\n`,
    },
  }
  const redacted = evaluateRedisCapacity({
    ...augmented,
    memoryLimitBytes: config.memoryLimitBytes,
  })
  assert.deepEqual(redacted, report)
  assert.deepEqual(Object.keys(redacted).sort(), [
    "memory",
    "persistence",
    "reasons",
    "schemaVersion",
    "stats",
    "status",
  ])
  const serialized = JSON.stringify(redacted)
  assert.equal(serialized.includes(canary), false)
  assert.equal(serialized.includes(url), false)
  assert.doesNotMatch(
    serialized,
    /redis:\/\/|redis_build_id|run_id|executable|config_file|master_host|slave0/u
  )
})

test("closes each connection and leaves observed configuration unchanged on a repeated read", async () => {
  const repeatedCommands = []
  const repeated = await collectRedisAudit({
    config,
    createClient: trackedFactory(repeatedCommands),
  })
  assert.deepEqual(repeatedCommands, expectedCommands)
  // CONFIG GET does not promise key order, so compare the fixed name/value pairs.
  const pairs = (flat) =>
    flat
      .filter((_, index) => index % 2 === 0)
      .map((key) => [key, flat[flat.indexOf(key) + 1]])
      .sort(([left], [right]) => left.localeCompare(right))
  assert.deepEqual(pairs(repeated.config), pairs(observation.config))
  assert.equal(clients.length, 2)
  assert.ok(clients.every((client) => !client.isOpen))
})

test("aborts a connected audit without sending mutation commands or retaining its socket", async () => {
  const controller = new AbortController()
  const abortedCommands = []
  await assert.rejects(
    collectRedisAudit({
      config,
      signal: controller.signal,
      createClient: trackedFactory(abortedCommands, () => controller.abort()),
    }),
    { message: "Redis capacity audit unavailable." }
  )
  assert.deepEqual(abortedCommands, [expectedCommands[0]])
  assert.equal(clients.length, 3)
  assert.ok(clients.every((client) => !client.isOpen))
})
