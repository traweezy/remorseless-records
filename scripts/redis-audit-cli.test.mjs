import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:net"
import { resolve } from "node:path"
import test from "node:test"

const credential = "fixture-redis-private-password"
const privateMarker = "fixture-redis-private-host"
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

const healthyObservation = () => ({
  config: {
    maxmemory: "67108864",
    "maxmemory-policy": "noeviction",
    appendonly: "yes",
    appendfsync: "everysec",
    save: "900 1 300 10 60 10000",
    "no-appendfsync-on-rewrite": "no",
  },
  info: {
    server: {
      redis_mode: "standalone",
      uptime_in_seconds: "123",
      config_file: `/private/${privateMarker}/redis.conf`,
    },
    memory: {
      maxmemory: "67108864",
      maxmemory_policy: "noeviction",
      used_memory: "1048576",
      mem_not_counted_for_evict: "0",
      used_memory_rss: "2097152",
      mem_fragmentation_ratio: "2.00",
    },
    persistence: {
      loading: "0",
      aof_enabled: "1",
      rdb_last_bgsave_status: "ok",
      rdb_last_save_time: "123",
      rdb_bgsave_in_progress: "0",
      aof_last_bgrewrite_status: "ok",
      aof_last_write_status: "ok",
      aof_rewrite_in_progress: "0",
      aof_rewrite_scheduled: "0",
      aof_delayed_fsync: "0",
      aof_pending_bio_fsync: "0",
      rdb_last_cow_size: "0",
      aof_last_cow_size: "0",
    },
    stats: {
      evicted_keys: "0",
      rejected_connections: "0",
      latest_fork_usec: "0",
    },
    replication: { role: "master", master_host: privateMarker },
    keyspace: { db0: "keys=3,expires=2,avg_ttl=1000" },
  },
})

const encodeBulk = (value) => `$${Buffer.byteLength(value)}\r\n${value}\r\n`

const encodeArray = (values) =>
  `*${values.length}\r\n${values.map(encodeBulk).join("")}`

const decodeCommand = (input) => {
  const headerEnd = input.indexOf("\r\n")
  if (headerEnd < 0) return null
  assert.match(input.slice(0, headerEnd), /^\*[1-9][0-9]?$/u)
  const count = Number(input.slice(1, headerEnd))
  const args = []
  let offset = headerEnd + 2
  for (let index = 0; index < count; index += 1) {
    const lengthEnd = input.indexOf("\r\n", offset)
    if (lengthEnd < 0) return null
    assert.match(input.slice(offset, lengthEnd), /^\$[0-9]+$/u)
    const length = Number(input.slice(offset + 1, lengthEnd))
    assert.ok(length <= 4096)
    offset = lengthEnd + 2
    if (input.length < offset + length + 2) return null
    args.push(input.slice(offset, offset + length))
    assert.equal(input.slice(offset + length, offset + length + 2), "\r\n")
    offset += length + 2
  }
  return { args, consumed: offset }
}

const invoke = (args = [], environment = {}, onChild = () => {}) =>
  new Promise((resolveResult, reject) => {
    const startedAt = performance.now()
    const child = spawn(
      process.execPath,
      [resolve("scripts/redis-capacity-audit.mjs"), ...args],
      { env: environment, stdio: ["ignore", "pipe", "pipe"] }
    )
    let stdout = ""
    let stderr = ""
    let timedOut = false
    const watchdog = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, 6000)
    child.stdout.on("data", (chunk) => {
      stdout += chunk
      if (stdout.length > 262_144) child.kill("SIGKILL")
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
      if (stderr.length > 262_144) child.kill("SIGKILL")
    })
    child.once("error", (error) => {
      clearTimeout(watchdog)
      reject(error)
    })
    child.once("close", (status, signal) => {
      clearTimeout(watchdog)
      resolveResult({
        status,
        signal,
        timedOut,
        stdout,
        stderr,
        durationMs: performance.now() - startedAt,
      })
    })
    onChild(child)
  })

const withServer = async (run, options = {}) => {
  const observation = healthyObservation()
  options.mutate?.(observation)
  const commands = []
  const sockets = new Set()
  let client
  let connectionCount = 0
  let closedCount = 0
  const server = createServer((socket) => {
    connectionCount += 1
    sockets.add(socket)
    socket.setEncoding("utf8")
    let pending = ""
    socket.on("error", () => {})
    socket.on("close", () => {
      closedCount += 1
      sockets.delete(socket)
    })
    socket.on("data", (chunk) => {
      pending += chunk
      assert.ok(pending.length <= 65_536)
      let command = decodeCommand(pending)
      while (command) {
        const args = command.args
        commands.push(args)
        pending = pending.slice(command.consumed)
        const name = args[0]
        if (options.signalAt === name) client.kill(options.signal)
        if (options.hangAt === name) {
          command = decodeCommand(pending)
          continue
        }
        if (options.errorAt === name)
          socket.write(`-ERR ${credential} ${privateMarker}\r\n`)
        else if (name === "AUTH") socket.write("+OK\r\n")
        else if (name === "CONFIG")
          socket.write(
            encodeArray(
              args.slice(2).flatMap((key) => [key, observation.config[key]])
            )
          )
        else if (name === "INFO") {
          const values = observation.info[args[1]]
          socket.write(
            encodeBulk(
              `# ${args[1]}\r\n${Object.entries(values)
                .map(([key, value]) => `${key}:${value}\r\n`)
                .join("")}`
            )
          )
        } else socket.write("-ERR unexpected fixture command\r\n")
        command = decodeCommand(pending)
      }
    })
  })
  await new Promise((resolveListening, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolveListening)
  })
  const address = server.address()
  assert.equal(typeof address, "object")
  const environment = {
    REDIS_AUDIT_URL: `redis://audit:${credential}@127.0.0.1:${address.port}/0`,
    REDIS_SERVICE_MEMORY_LIMIT_BYTES: "134217728",
    REDIS_AUDIT_TIMEOUT_MS: "1000",
  }
  try {
    await run({
      commands,
      environment,
      invoke: (args = [], overrides = {}) =>
        invoke(args, { ...environment, ...overrides }, (child) => {
          client = child
        }),
      connectionCount: () => connectionCount,
      closedCount: () => closedCount,
    })
  } finally {
    const closed = once(server, "close")
    for (const socket of sockets) socket.destroy()
    server.close()
    await closed
  }
}

const assertRedacted = (result) => {
  assert.equal(result.timedOut, false)
  assert.equal(result.signal, null)
  for (const secret of [credential, privateMarker, "redis://", "rediss://"])
    assert.equal((result.stdout + result.stderr).includes(secret), false)
}

const assertUnavailable = (result) => {
  assertRedacted(result)
  assert.equal(result.status, 1)
  assert.equal(result.stdout, "")
  const report = JSON.parse(result.stderr)
  assert.deepEqual(Object.keys(report).sort(), [
    "durationMs",
    "event",
    "reason",
    "schemaVersion",
  ])
  assert.equal(report.schemaVersion, 1)
  assert.equal(report.event, "redis.capacity_audit.failed")
  assert.equal(report.reason, "audit_unavailable")
  assert.ok(Number.isSafeInteger(report.durationMs))
  assert.ok(report.durationMs >= 0)
}

test("audit help works without credentials and describes read-only limits", async () => {
  const result = await invoke(["--help"])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, "")
  assert.match(result.stdout, /REDIS_AUDIT_URL/u)
  assert.match(result.stdout, /REDIS_SERVICE_MEMORY_LIMIT_BYTES/u)
  assert.match(result.stdout, /REDIS_AUDIT_TIMEOUT_MS/u)
  assert.match(result.stdout, /read.only/iu)
  assert.match(result.stdout, /certificate verification/u)
})

test("CLI rejects unknown, duplicate, positional, and mixed-help arguments", async () => {
  for (const args of [
    ["--apply"],
    ["--help", "--help"],
    ["--help", "--apply"],
    ["--url", `redis://audit:${credential}@localhost`],
    ["--"],
    [credential],
  ])
    assertUnavailable(await invoke(args))
})

test("invalid configuration is unavailable without revealing endpoint details", async () => {
  for (const environment of [
    {},
    {
      REDIS_AUDIT_URL: `redis://audit:${credential}@${privateMarker}`,
      REDIS_SERVICE_MEMORY_LIMIT_BYTES: "134217728",
    },
    {
      REDIS_AUDIT_URL: `rediss://audit:${credential}@${privateMarker}`,
      REDIS_SERVICE_MEMORY_LIMIT_BYTES: "134217728bytes",
    },
    {
      REDIS_AUDIT_URL: `redis://audit:${credential}@localhost/1`,
      REDIS_SERVICE_MEMORY_LIMIT_BYTES: "134217728",
    },
  ])
    assertUnavailable(await invoke([], environment))
})

test("healthy CLI observes exact read-only commands on one closed connection", () =>
  withServer(
    async ({ invoke: run, commands, connectionCount, closedCount }) => {
      const result = await run()
      assertRedacted(result)
      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.stderr, "")
      const report = JSON.parse(result.stdout)
      assert.equal(report.schemaVersion, 1)
      assert.equal(report.event, "redis.capacity_audit.completed")
      assert.equal(report.status, "healthy")
      assert.deepEqual(report.reasons, [])
      assert.match(report.endpointFingerprint, /^[0-9a-f]{64}$/u)
      assert.ok(Number.isSafeInteger(report.durationMs))
      assert.deepEqual(commands, [
        ["AUTH", "audit", credential],
        ["CONFIG", "GET", ...configKeys],
        ...infoSections.map((section) => ["INFO", section]),
      ])
      assert.equal(connectionCount(), 1)
      assert.equal(closedCount(), 1)
    }
  ))

test("degraded CLI returns structured evidence and exit two without mutation", () =>
  withServer(
    async ({ invoke: run, commands }) => {
      const result = await run()
      assertRedacted(result)
      assert.equal(result.status, 2, result.stderr)
      assert.equal(result.stderr, "")
      const report = JSON.parse(result.stdout)
      assert.equal(report.event, "redis.capacity_audit.completed")
      assert.equal(report.status, "degraded")
      assert.ok(report.reasons.length > 0)
      assert.equal(commands.length, 8)
    },
    {
      mutate: (observation) => {
        observation.config["maxmemory-policy"] = "allkeys-lru"
        observation.info.memory.maxmemory_policy = "allkeys-lru"
      },
    }
  ))

for (const phase of ["AUTH", "CONFIG", "INFO"]) {
  test(`CLI suppresses raw ${phase} errors and closes its connection`, () =>
    withServer(
      async ({ invoke: run, commands, connectionCount, closedCount }) => {
        assertUnavailable(await run())
        assert.equal(commands.at(-1)[0], phase)
        assert.equal(connectionCount(), 1)
        assert.equal(closedCount(), 1)
      },
      { errorAt: phase }
    ))
}

for (const phase of ["AUTH", "CONFIG"]) {
  test(`CLI deadline terminates a hung ${phase} without socket leakage or retry`, () =>
    withServer(
      async ({ invoke: run, connectionCount, closedCount }) => {
        const result = await run([], { REDIS_AUDIT_TIMEOUT_MS: "100" })
        assertUnavailable(result)
        assert.ok(result.durationMs < 3000)
        assert.equal(connectionCount(), 1)
        assert.equal(closedCount(), 1)
      },
      { hangAt: phase }
    ))
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  test(`CLI ${signal} cancels active reads and closes transport`, () =>
    withServer(
      async ({ invoke: run, commands, closedCount }) => {
        assertUnavailable(await run())
        assert.equal(commands.at(-1)[0], "CONFIG")
        assert.equal(closedCount(), 1)
      },
      { signalAt: "CONFIG", signal, hangAt: "CONFIG" }
    ))
}

test("CLI refuses malformed evidence without printing server values", () =>
  withServer(async ({ invoke: run }) => assertUnavailable(await run()), {
    mutate: (observation) => {
      observation.info.memory.used_memory = credential
    },
  }))
