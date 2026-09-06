import assert from "node:assert/strict"
import { EventEmitter, getEventListeners, once } from "node:events"
import { createRequire } from "node:module"
import { createServer } from "node:net"
import { setTimeout as delay } from "node:timers/promises"
import test from "node:test"
import {
  collectRedisAudit,
  parseRedisAuditEnvironment,
} from "./lib/redis-audit-client.mjs"

const auditEnvironment = (overrides = {}) => ({
  REDIS_AUDIT_URL: "redis://audit:fixture-password@localhost:6379/0",
  REDIS_SERVICE_MEMORY_LIMIT_BYTES: "1073741824",
  ...overrides,
})

const parse = (overrides) =>
  parseRedisAuditEnvironment(auditEnvironment(overrides))

const createFakeClient = (overrides = {}) => {
  const client = new EventEmitter()
  const calls = []
  let destroyed = 0
  let connected = 0
  client.isOpen = false
  client.connect = async () => {
    connected += 1
    client.isOpen = true
    if (overrides.connect) return overrides.connect(client)
    return client
  }
  client.sendCommand = async (command, options) => {
    calls.push({ command, options })
    if (overrides.sendCommand)
      return overrides.sendCommand(command, options, client)
    if (command[0] === "CONFIG")
      return command.slice(2).flatMap((key) => [key, `fixture-${key}`])
    return `# ${command[1]}\r\nfixture_field:1\r\n`
  }
  client.destroy = () => {
    destroyed += 1
    client.isOpen = false
    return overrides.destroy?.(client)
  }
  return {
    client,
    calls,
    destructionCount: () => destroyed,
    connectionCount: () => connected,
  }
}

test("environment parser accepts only reviewed plaintext endpoint boundaries", () => {
  for (const endpoint of [
    "redis://localhost",
    "redis://127.0.0.1:6379/0",
    "redis://[::1]:6380/0",
    "redis://cache.railway.internal:6379/0",
  ]) {
    const config = parse({ REDIS_AUDIT_URL: endpoint })
    assert.equal(config.memoryLimitBytes, 1_073_741_824)
    assert.equal(config.timeoutMs, 5000)
  }
})

test("environment parser pins safe client protocol, queue, and TLS options", () => {
  const config = parse({
    REDIS_AUDIT_URL:
      "rediss://audit:fixture-password@redis.example.invalid:6380/0",
    NODE_TLS_REJECT_UNAUTHORIZED: "0",
    REDIS_URL: "redis://unrelated-ambient-endpoint:1234/5",
  })
  assert.equal(config.clientOptions.RESP, 2)
  assert.equal(config.clientOptions.disableClientInfo, true)
  assert.equal(config.clientOptions.disableOfflineQueue, true)
  assert.equal(config.clientOptions.socket.reconnectStrategy, false)
  assert.equal(config.clientOptions.socket.tls, true)
  assert.equal(config.clientOptions.socket.rejectUnauthorized, true)
  assert.equal(config.clientOptions.socket.servername, "redis.example.invalid")
  for (const host of ["127.0.0.1", "[::1]"])
    assert.equal(
      parse({ REDIS_AUDIT_URL: `rediss://${host}` }).clientOptions.socket
        .servername,
      undefined
    )
})

test("endpoint fingerprints ignore credentials but distinguish endpoint changes", () => {
  const original = parse().endpointFingerprint
  assert.equal(typeof original, "string")
  assert.ok(original.length >= 32)
  assert.doesNotMatch(original, /localhost|fixture|password/u)
  assert.equal(
    parse({ REDIS_AUDIT_URL: "redis://rotated:other@localhost:6379/0" })
      .endpointFingerprint,
    original
  )
  assert.equal(
    parse({ REDIS_AUDIT_URL: "redis://localhost" }).endpointFingerprint,
    original
  )
  assert.notEqual(
    parse({ REDIS_AUDIT_URL: "redis://localhost:6380/0" }).endpointFingerprint,
    original
  )
  assert.equal(
    parse({ REDIS_AUDIT_URL: "rediss://localhost:6379/0" }).endpointFingerprint,
    original
  )
})

test("environment parser rejects unreviewed URLs without revealing credentials", () => {
  for (const value of [
    undefined,
    "",
    "redis://",
    "https://localhost",
    "file:///tmp/redis.sock",
    "redis://external.example.invalid",
    "redis://railway.internal",
    "redis://cache.railway.internal.evil.invalid",
    "redis://localhost.evil.invalid",
    "redis://127.0.0.2",
    "redis://localhost/1",
    "redis://localhost/-1",
    "redis://localhost/01",
    "redis://localhost/0/other",
    "redis://localhost/other",
    "redis://localhost?tls=false",
    "redis://localhost?",
    "rediss://localhost?rejectUnauthorized=false",
    "redis://localhost#fragment",
    "redis://localhost#",
    "redis://fixture:fixture-password@localhost:0/0",
    "redis://fixture:fixture-password@localhost:65536/0",
    "redis://fixture:fixture-password@local\nhost/0",
    "redis://fixture:fixture-password%00@localhost/0",
    "redis://fixture%0a:fixture-password@localhost/0",
    " redis://fixture:fixture-password@localhost/0",
  ])
    assert.throws(
      () => parse({ REDIS_AUDIT_URL: value }),
      (error) => {
        assert.doesNotMatch(
          error.message,
          /fixture-password|fixture%|external\.example/u
        )
        return true
      },
      `Expected rejection for URL fixture ${String(value)}`
    )
})

test("memory limit parsing is exact decimal and bounded to 16 MiB through 16 TiB", () => {
  assert.equal(
    parse({ REDIS_SERVICE_MEMORY_LIMIT_BYTES: "16777216" }).memoryLimitBytes,
    16 * 1024 * 1024
  )
  assert.equal(
    parse({ REDIS_SERVICE_MEMORY_LIMIT_BYTES: "17592186044416" })
      .memoryLimitBytes,
    16 * 1024 ** 4
  )
  for (const value of [
    undefined,
    "",
    "0",
    "16777215",
    "17592186044417",
    "Infinity",
    "1073741824bytes",
    "1e9",
    "0x40000000",
    "01073741824",
    "+1073741824",
    "1073741824.0",
    "1073741824 ",
    " 1073741824",
  ])
    assert.throws(() => parse({ REDIS_SERVICE_MEMORY_LIMIT_BYTES: value }))
})

test("audit timeout parsing rejects partial values and enforces the full budget", () => {
  assert.equal(parse().timeoutMs, 5000)
  assert.equal(parse({ REDIS_AUDIT_TIMEOUT_MS: "100" }).timeoutMs, 100)
  assert.equal(parse({ REDIS_AUDIT_TIMEOUT_MS: "30000" }).timeoutMs, 30_000)
  for (const value of [
    "",
    "0",
    "99",
    "30001",
    "Infinity",
    "1e3",
    "100ms",
    "0100",
    "+100",
    "100.0",
    " 100",
    "100 ",
  ])
    assert.throws(() => parse({ REDIS_AUDIT_TIMEOUT_MS: value }))
})

test("collector uses one client and only scoped CONFIG GET and INFO commands", async () => {
  const fake = createFakeClient()
  const config = parse()
  let created = 0
  const raw = await collectRedisAudit({
    config,
    createClient: (options) => {
      created += 1
      assert.ok(options.socket.signal instanceof AbortSignal)
      assert.equal(options.socket.signal.aborted, false)
      const { signal: _signal, ...socket } = options.socket
      assert.deepEqual({ ...options, socket }, config.clientOptions)
      return fake.client
    },
  })
  assert.equal(created, 1)
  assert.equal(fake.connectionCount(), 1)
  assert.equal(fake.destructionCount(), 1)
  assert.equal(fake.client.isOpen, false)
  assert.equal(fake.calls.length, 7)
  const configuration = fake.calls.filter(
    ({ command }) => command[0] === "CONFIG"
  )
  assert.equal(configuration.length, 1)
  assert.equal(configuration[0].command[1], "GET")
  assert.deepEqual(configuration[0].command.slice(2), [
    "maxmemory",
    "maxmemory-policy",
    "appendonly",
    "appendfsync",
    "save",
    "no-appendfsync-on-rewrite",
  ])
  assert.deepEqual(
    fake.calls
      .filter(({ command }) => command[0] === "INFO")
      .map(({ command }) => command[1])
      .sort(),
    ["keyspace", "memory", "persistence", "replication", "server", "stats"]
  )
  for (const { options } of fake.calls) {
    assert.ok(options.abortSignal instanceof AbortSignal)
  }
  assert.ok(raw.config)
  assert.ok(raw.info)
})

test("collector destroys the client after connection or command failures", async () => {
  for (const phase of ["connect", "sendCommand"]) {
    const fake = createFakeClient({
      [phase]: () => {
        throw new Error("fixture-password redis://private-endpoint")
      },
    })
    await assert.rejects(
      collectRedisAudit({ config: parse(), createClient: () => fake.client }),
      (error) => {
        assert.doesNotMatch(error.message, /fixture-password|private-endpoint/u)
        return true
      }
    )
    assert.equal(fake.destructionCount(), 1)
    assert.equal(fake.client.isOpen, false)
  }
})

for (const phase of ["connect", "sendCommand"]) {
  test(`collector deadline destroys a hung ${phase} before rejecting`, async () => {
    const fake = createFakeClient({ [phase]: () => new Promise(() => {}) })
    const started = performance.now()
    // Keep this fake transport alive just as a pending real socket would be.
    const keepAlive = setInterval(() => {}, 1000)
    try {
      await assert.rejects(
        collectRedisAudit({
          config: parse({ REDIS_AUDIT_TIMEOUT_MS: "100" }),
          createClient: () => fake.client,
        })
      )
      assert.equal(fake.destructionCount(), 1)
      assert.equal(fake.client.isOpen, false)
      assert.ok(performance.now() - started < 2000)
    } finally {
      clearInterval(keepAlive)
    }
  })
}

test("collector aborts active commands, destroys transport, and stops reads", async () => {
  const controller = new AbortController()
  const fake = createFakeClient({
    sendCommand: () => {
      controller.abort(new Error("fixture-password"))
      return new Promise(() => {})
    },
  })
  await assert.rejects(
    collectRedisAudit({
      config: parse(),
      createClient: () => fake.client,
      signal: controller.signal,
    })
  )
  assert.equal(fake.destructionCount(), 1)
  assert.equal(fake.calls.length, 1)
})

test("pre-aborted collection never establishes a connection", async () => {
  const fake = createFakeClient()
  await assert.rejects(
    collectRedisAudit({
      config: parse(),
      createClient: () => fake.client,
      signal: AbortSignal.abort(new Error("fixture-password")),
    })
  )
  assert.equal(fake.connectionCount(), 0)
  assert.equal(fake.calls.length, 0)
})

test("transport error events end the audit and destroy the connection", async () => {
  const fake = createFakeClient({
    sendCommand: (_command, _options, client) => {
      queueMicrotask(() => client.emit("error", new Error("fixture-password")))
      return new Promise(() => {})
    },
  })
  await assert.rejects(
    collectRedisAudit({ config: parse(), createClient: () => fake.client })
  )
  assert.equal(fake.destructionCount(), 1)
  assert.equal(fake.calls.length, 1)
})

test("one deadline covers all sequential commands rather than restarting per read", async () => {
  const fake = createFakeClient({
    sendCommand: async () => {
      await delay(70)
      return "fixture"
    },
  })
  await assert.rejects(
    collectRedisAudit({
      config: parse({ REDIS_AUDIT_TIMEOUT_MS: "100" }),
      createClient: () => fake.client,
    })
  )
  assert.equal(fake.destructionCount(), 1)
  const commandsAtDeadline = fake.calls.length
  assert.ok(commandsAtDeadline < 7)
  await delay(100)
  assert.equal(fake.calls.length, commandsAtDeadline)
})

test("cleanup failure withholds otherwise successful audit results", async () => {
  const fake = createFakeClient({
    destroy: () => {
      throw new Error("fixture-password")
    },
  })
  await assert.rejects(
    collectRedisAudit({ config: parse(), createClient: () => fake.client }),
    (error) => {
      assert.doesNotMatch(error.message, /fixture-password/u)
      return true
    }
  )
  assert.equal(fake.destructionCount(), 1)
})

test("client construction failures are redacted and external abort listeners removed", async () => {
  const controller = new AbortController()
  const before = getEventListeners(controller.signal, "abort")
  await assert.rejects(
    collectRedisAudit({
      config: parse(),
      createClient: () => {
        throw new Error("fixture-password")
      },
      signal: controller.signal,
    }),
    (error) => {
      assert.doesNotMatch(error.message, /fixture-password/u)
      return true
    }
  )
  assert.deepEqual(getEventListeners(controller.signal, "abort"), before)
})

test("successful cleanup removes external abort listeners and tolerates late errors", async () => {
  const fake = createFakeClient()
  const controller = new AbortController()
  const before = getEventListeners(controller.signal, "abort")
  await collectRedisAudit({
    config: parse(),
    createClient: () => fake.client,
    signal: controller.signal,
  })
  assert.deepEqual(getEventListeners(controller.signal, "abort"), before)
  fake.client.emit("error", new Error("fixture-password"))
  controller.abort()
  assert.equal(fake.destructionCount(), 1)
})

for (const cancellation of ["deadline", "external abort"]) {
  test(`pending TLS ${cancellation} promptly closes the real peer socket`, async () => {
    const require = createRequire(
      new URL("../backend/package.json", import.meta.url)
    )
    const { createClient } = require("redis")
    const controller = new AbortController()
    const sockets = new Set()
    let abortTimer
    let accepted = 0
    let closed = 0
    const server = createServer((socket) => {
      accepted += 1
      sockets.add(socket)
      // Accept TCP but never answer the TLS ClientHello.
      socket.on("data", () => {})
      socket.on("error", () => {})
      socket.on("close", () => {
        sockets.delete(socket)
        closed += 1
      })
      if (cancellation === "external abort")
        abortTimer = setTimeout(() => controller.abort(), 20)
    })
    await new Promise((resolveListening, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", resolveListening)
    })
    const address = server.address()
    assert.equal(typeof address, "object")
    try {
      await assert.rejects(
        collectRedisAudit({
          config: parse({
            REDIS_AUDIT_URL: `rediss://127.0.0.1:${address.port}/0`,
            REDIS_AUDIT_TIMEOUT_MS:
              cancellation === "deadline" ? "100" : "3000",
          }),
          createClient,
          signal: controller.signal,
        })
      )
      assert.equal(accepted, 1)
      // FIN/error delivery is asynchronous at the peer. This is well below
      // the 3 s connect budget, so cancellation cannot pass via that timeout.
      await delay(150)
      assert.equal(closed, 1)
      assert.equal(sockets.size, 0)
    } finally {
      clearTimeout(abortTimer)
      const serverClosed = once(server, "close")
      for (const socket of sockets) socket.destroy()
      server.close()
      await serverClosed
    }
  })
}
