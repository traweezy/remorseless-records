import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { createRequire } from "node:module"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import test from "node:test"
import { runRecoveryCommand } from "./lib/recovery-process.mjs"

const requireBackend = createRequire(
  new URL("../backend/package.json", import.meta.url)
)
const { createClient } = requireBackend("redis")
const password = "synthetic_redis_runtime_canary_12345"
const image = process.env.RR_REDIS_RUNTIME_IMAGE_ID
const info = (text) =>
  Object.fromEntries(
    text
      .split(/\r?\n/u)
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => [
        line.slice(0, line.indexOf(":")),
        line.slice(line.indexOf(":") + 1),
      ])
  )

test("Redis startup rejects missing credentials, missing data, root and command overrides", async () => {
  assert.equal(process.env.INTEGRATION_TESTS_ENABLED, "1")
  assert.match(image ?? "", /^sha256:[a-f0-9]{64}$/u)
  for (const [options, command] of [
    [[], []],
    [["--env", `REDISPASSWORD=${password}`], []],
    [["--user", "0", "--env", `REDISPASSWORD=${password}`], []],
    [
      ["--env", `REDISPASSWORD=${password}`],
      ["--save", ""],
    ],
  ]) {
    await assert.rejects(
      runRecoveryCommand(
        "/usr/bin/docker",
        [
          "--context",
          "default",
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
          "64m",
          "--pids-limit",
          "16",
          ...options,
          image,
          ...command,
        ],
        {
          environment: { PATH: process.env.PATH, HOME: process.env.HOME },
          signal: AbortSignal.timeout(10000),
          maxOutputBytes: 1024,
        }
      )
    )
  }
})

test("persistent Redis preserves authentication, headroom and data across forks and restart", {
  timeout: 150_000,
}, async () => {
  assert.equal(process.env.INTEGRATION_TESTS_ENABLED, "1")
  assert.match(image ?? "", /^sha256:[a-f0-9]{64}$/u)
  const signal = AbortSignal.timeout(140_000)
  const run = (args, maxOutputBytes = 8192) =>
    runRecoveryCommand("/usr/bin/docker", ["--context", "default", ...args], {
      environment: { PATH: process.env.PATH, HOME: process.env.HOME },
      signal,
      maxOutputBytes,
    })
  const root = await mkdtemp(join(tmpdir(), "rr-redis-runtime-"))
  const data = join(root, "data"),
    temporary = join(root, "tmp")
  const name = `rr-redis-runtime-${randomUUID()}`
  let container, client, relay
  const transports = new Set()
  const stopTransports = () => {
    for (const transport of transports) transport()
    if (client?.isOpen) client.destroy()
  }
  signal.addEventListener("abort", stopTransports, { once: true })
  try {
    // All mounted data is synthetic. Different CI host and container UIDs may
    // share these directories; credentials in the runtime config stay 0600.
    await chmod(root, 0o755)
    for (const path of [data, join(data, "appendonlydir"), temporary]) {
      await mkdir(path)
      await chmod(path, 0o777)
    }
    await writeFile(
      join(data, "appendonlydir/appendonly.aof.manifest"),
      "file appendonly.aof.1.incr.aof seq 1 type i\n"
    )
    const incremental = join(data, "appendonlydir/appendonly.aof.1.incr.aof")
    await writeFile(
      incremental,
      "*3\r\n$3\r\nSET\r\n$7\r\nrr:seed\r\n$9\r\npreserved\r\n"
    )
    await chmod(incremental, 0o666)
    const originalIncremental = await readFile(incremental)
    container = await run([
      "run",
      "--detach",
      "--pull",
      "never",
      "--name",
      name,
      "--label",
      `com.remorseless.redis-drill=${name}`,
      "--network",
      "none",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--memory",
      "1000000000",
      "--memory-swap",
      "1000000000",
      "--cpus",
      "1",
      "--pids-limit",
      "64",
      "--mount",
      `type=bind,source=${data},target=/bitnami/redis/data`,
      "--mount",
      `type=bind,source=${temporary},target=/tmp`,
      "--env",
      `REDISPASSWORD=${password}`,
      image,
    ])
    assert.match(container, /^[a-f0-9]{64}$/u)
    const actual = JSON.parse(await run(["inspect", container], 32768))[0]
    assert.equal(actual.Image, image)
    assert.equal(actual.Config.User, "1000:1000")
    assert.equal(actual.HostConfig.Memory, 1000000000)
    assert.equal(actual.HostConfig.NetworkMode, "none")
    assert.equal(actual.HostConfig.ReadonlyRootfs, true)
    // The server keeps UID 1000 and a private 0600 Unix socket. CI's host UID
    // can differ, so relay loopback TCP through docker exec without exposing
    // ports or giving this network-less container an egress path.
    relay = createServer((socket) => {
      if (transports.size >= 4) {
        socket.destroy()
        return
      }
      const child = spawn(
        "/usr/bin/docker",
        [
          "--context",
          "default",
          "exec",
          "--interactive",
          container,
          "/bin/busybox",
          "nc",
          "127.0.0.1",
          "6379",
        ],
        {
          env: { PATH: process.env.PATH, HOME: process.env.HOME },
          stdio: ["pipe", "pipe", "ignore"],
          signal,
        }
      )
      const close = () => {
        socket.destroy()
        child.kill("SIGKILL")
        transports.delete(close)
      }
      transports.add(close)
      socket.on("error", close)
      socket.on("close", close)
      child.on("error", close)
      child.on("close", close)
      child.stdin.on("error", close)
      child.stdout.on("error", close)
      socket.pipe(child.stdin)
      child.stdout.pipe(socket)
    })
    await new Promise((resolve, reject) => {
      relay.once("error", reject)
      relay.listen(0, "127.0.0.1", resolve)
    })
    const port = relay.address().port
    const connect = async () => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const c = createClient({
          username: "default",
          password,
          disableOfflineQueue: true,
          socket: {
            host: "127.0.0.1",
            port,
            reconnectStrategy: false,
            connectTimeout: 1000,
          },
        })
        c.on("error", () => {})
        try {
          await c.connect()
          assert.equal(await c.ping(), "PONG")
          return c
        } catch {
          if (c.isOpen) c.destroy()
          await delay(100, undefined, { signal })
        }
      }
      throw new Error("Redis runtime did not become ready")
    }
    client = await connect()
    assert.equal(await client.get("rr:seed"), "preserved")
    const config = await client.configGet([
      "maxmemory",
      "maxmemory-policy",
      "appendonly",
      "appendfsync",
      "save",
      "no-appendfsync-on-rewrite",
    ])
    assert.deepEqual(
      { ...config },
      {
        maxmemory: "536870912",
        "maxmemory-policy": "noeviction",
        appendonly: "yes",
        appendfsync: "everysec",
        save: "900 1 300 10 60 10000",
        "no-appendfsync-on-rewrite": "no",
      }
    )
    const unauthenticated = createClient({
      socket: { host: "127.0.0.1", port, reconnectStrategy: false },
    })
    unauthenticated.on("error", () => {})
    try {
      await assert.rejects(async () => {
        await unauthenticated.connect()
        await unauthenticated.get("rr:seed")
      }, /NOAUTH/u)
    } finally {
      if (unauthenticated.isOpen) unauthenticated.destroy()
    }

    const value = "x".repeat(8192)
    const durations = []
    for (let offset = 0; offset < 32768; offset += 64) {
      const started = performance.now()
      await Promise.all(
        Array.from({ length: 64 }, (_, i) =>
          client.set(`rr:load:${offset + i}`, value)
        )
      )
      durations.push(performance.now() - started)
    }
    const settle = async () => {
      for (let attempt = 0; attempt < 300; attempt++) {
        const p = info(await client.info("persistence"))
        if (
          p.rdb_bgsave_in_progress === "0" &&
          p.aof_rewrite_in_progress === "0" &&
          p.aof_rewrite_scheduled === "0"
        )
          return p
        await delay(100, undefined, { signal })
      }
      throw new Error("Redis persistence did not settle")
    }
    await settle()
    for (const command of ["BGSAVE", "BGREWRITEAOF"]) {
      await client.sendCommand([command])
      for (let offset = 0; offset < 8192; offset += 64)
        await Promise.all(
          Array.from({ length: 64 }, (_, i) =>
            client.set(`rr:load:${(offset + i) * 4}`, value)
          )
        )
      const p = await settle()
      assert.equal(p.rdb_last_bgsave_status, "ok")
      assert.equal(p.aof_last_bgrewrite_status, "ok")
      assert.equal(p.aof_last_write_status, "ok")
    }
    const memory = info(await client.info("memory")),
      persistence = info(await client.info("persistence")),
      stats = info(await client.info("stats"))
    const peak = Number(
      await run(["exec", container, "cat", "/sys/fs/cgroup/memory.peak"])
    )
    assert.ok(peak > 268435456 && peak < 900000000)
    assert.equal(stats.evicted_keys, "0")
    assert.equal(stats.rejected_connections, "0")
    assert.equal(await client.dbSize(), 32769)
    client.destroy()
    client = undefined
    const started = performance.now()
    assert.equal(
      await run(["restart", "--timeout", "10", container]),
      container
    )
    client = await connect()
    const restartMs = Math.round(performance.now() - started)
    assert.equal(await client.dbSize(), 32769)
    assert.equal(await client.get("rr:seed"), "preserved")
    assert.equal(await client.get("rr:load:32764"), value)
    assert.deepEqual(await readFile(incremental), originalIncremental)
    durations.sort((a, b) => a - b)
    console.log(
      JSON.stringify({
        event: "redis.runtime_drill.passed",
        imageId: image,
        syntheticKeys: 32769,
        serviceLimitBytes: 1000000000,
        maxmemoryBytes: 536870912,
        cgroupPeakBytes: peak,
        usedMemoryPeakBytes: Number(memory.used_memory_peak),
        rssBytes: Number(memory.used_memory_rss),
        rdbCowBytes: Number(persistence.rdb_last_cow_size),
        aofCowBytes: Number(persistence.aof_last_cow_size),
        pipeline64P95Ms: Math.round(
          durations[Math.floor(durations.length * 0.95)]
        ),
        restartMs,
      })
    )
  } finally {
    stopTransports()
    if (relay) await new Promise((resolve) => relay.close(resolve))
    signal.removeEventListener("abort", stopTransports)
    if (container) {
      const cleanup = (args) =>
        runRecoveryCommand(
          "/usr/bin/docker",
          ["--context", "default", ...args],
          {
            environment: { PATH: process.env.PATH, HOME: process.env.HOME },
            signal: AbortSignal.timeout(15000),
            maxOutputBytes: 1024,
          }
        )
      const label = await cleanup([
        "inspect",
        "--format",
        '{{index .Config.Labels "com.remorseless.redis-drill"}}',
        container,
      ])
      assert.equal(label, name)
      await cleanup(["rm", "--force", container])
      // Only this drill's synthetic child directory has container UID 1000.
      // Remove it with that UID so CI hosts using UID 1001 can clean up too.
      await cleanup([
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
        "64m",
        "--pids-limit",
        "16",
        "--mount",
        `type=bind,source=${data},target=/data`,
        "--entrypoint",
        "/bin/rm",
        image,
        "-rf",
        "/data/runtime",
      ])
    }
    await rm(root, { recursive: true, force: true })
  }
})
