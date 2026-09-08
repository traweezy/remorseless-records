import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  integrationEnvironment,
  parseIntegrationArguments,
  runDisposableIntegration,
  runIntegrationCommand,
} from "./run-disposable-integration.mjs"

const postgresId = `sha256:${"a".repeat(64)}`
const redisId = `sha256:${"b".repeat(64)}`
const scanned = {
  RR_INTEGRATION_POSTGRES_IMAGE_ID: postgresId,
  RR_INTEGRATION_REDIS_IMAGE_ID: redisId,
}
const postgresContainer = "c".repeat(64)
const redisContainer = "d".repeat(64)
const fakeRunner = (override = () => undefined) => {
  const calls = []
  const signals = new EventEmitter()
  const commandRunner = async (command, args, options) => {
    const call = { command, args, options }
    calls.push(call)
    const overridden = await override(call, calls, signals)
    if (overridden !== undefined) return overridden
    if (args[0] === "image")
      return args.at(-1).includes("postgres") ? postgresId : redisId
    if (args.includes("--quiet"))
      return args.at(-1) === "postgres" ? postgresContainer : redisContainer
    if (args.includes("{{json .NetworkSettings.Ports}}"))
      return JSON.stringify(
        args.at(-1) === postgresContainer
          ? { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "55432" }] }
          : { "6379/tcp": [{ HostIp: "127.0.0.1", HostPort: "56379" }] }
      )
    if (args[0] === "inspect")
      return args.at(-1) === postgresContainer ? postgresId : redisId
    return ""
  }
  const invoke = (options = {}) =>
    runDisposableIntegration({
      environment: {},
      commandRunner,
      signals,
      ...options,
    })
  return { calls, signals, invoke }
}
const stage = ({ command, args }) =>
  command === "pnpm"
    ? "tests"
    : args[0] === "compose"
      ? args[args.indexOf("compose.integration.yml") + 1]
      : args[0]
const actionOptions = ({ args }) =>
  args.slice(args.indexOf("compose.integration.yml") + 2)
const assertNoListeners = (signals) => {
  assert.equal(signals.listenerCount("SIGINT"), 0)
  assert.equal(signals.listenerCount("SIGTERM"), 0)
}

test("strictly accepts only build default or one no-build flag with optional pnpm separator", () => {
  for (const args of [[], ["--"]])
    assert.deepEqual(parseIntegrationArguments(args), { build: true })
  for (const args of [["--no-build"], ["--", "--no-build"]])
    assert.deepEqual(parseIntegrationArguments(args), { build: false })
  for (const args of [
    ["--help"],
    ["--pull"],
    ["--no-build", "--no-build"],
    ["--", "--", "--no-build"],
    ["--no-build", "--"],
  ])
    assert.throws(
      () => parseIntegrationArguments(args),
      /Expected no arguments/u
    )
})

test("pins disposable credentials, blanks providers and supports only distinct nonprivileged ports", () => {
  const result = integrationEnvironment({
    DATABASE_URL: "private",
    REDIS_URL: "private",
    STRIPE_API_KEY: "private",
    STRIPE_LIFECYCLE_WEBHOOK_SECRET: "private",
    STRIPE_PAYMENT_METHOD_CONFIGURATION: "private",
    STRIPE_WEBHOOK_SECRET: "private",
    RR_INTEGRATION_POSTGRES_PORT: "55433",
    RR_INTEGRATION_REDIS_PORT: "56380",
  })
  assert.equal(
    result.DATABASE_URL,
    "postgresql://postgres:local_integration_only@localhost:55433/postgres"
  )
  assert.equal(result.REDIS_URL, "redis://127.0.0.1:56380")
  assert.equal(result.DB_PORT, "55433")
  for (const key of [
    "STRIPE_API_KEY",
    "STRIPE_LIFECYCLE_WEBHOOK_SECRET",
    "STRIPE_PAYMENT_METHOD_CONFIGURATION",
    "STRIPE_WEBHOOK_SECRET",
  ])
    assert.equal(result[key], "")
  assert.equal(integrationEnvironment({}).DB_PORT, "55432")
  for (const raw of ["abc", "1", "1023", "65536", "123456", "12.5", "1e4"])
    assert.throws(() =>
      integrationEnvironment({ RR_INTEGRATION_REDIS_PORT: raw })
    )
  assert.throws(
    () => integrationEnvironment({ RR_INTEGRATION_REDIS_PORT: "55432" }),
    /distinct/u
  )
})

test("builds before startup, verifies actual image IDs, runs full aggregate and always cleans owned startup", async () => {
  const fixture = fakeRunner()
  assert.equal(await fixture.invoke(), 0)
  assert.deepEqual(fixture.calls.map(stage), [
    "ps",
    "network",
    "volume",
    "build",
    "image",
    "image",
    "up",
    "ps",
    "inspect",
    "inspect",
    "ps",
    "inspect",
    "inspect",
    "tests",
    "down",
  ])
  const up = fixture.calls.find((call) => stage(call) === "up")
  assert.deepEqual(up.args.slice(0, 3), ["compose", "--env-file", "/dev/null"])
  assert.deepEqual(actionOptions(up), [
    "--no-build",
    "--pull",
    "never",
    "--detach",
    "--wait",
    "--wait-timeout",
    "120",
  ])
  assert.equal(up.options.timeoutMs, 150_000)
  assert.equal(
    fixture.calls.find((call) => stage(call) === "build").options.timeoutMs,
    600_000
  )
  const tests = fixture.calls.find((call) => call.command === "pnpm")
  assert.deepEqual(tests.args, ["run", "qa:disposable-integration:services"])
  assert.equal(tests.options.timeoutMs, 900_000)
  assert.equal(tests.options.environment.INTEGRATION_TESTS_ENABLED, "1")
  const cleanup = fixture.calls.at(-1)
  assert.deepEqual(actionOptions(cleanup), [
    "--volumes",
    "--remove-orphans",
    "--timeout",
    "10",
  ])
  assert.equal(cleanup.options.timeoutMs, 30_000)
  assert.equal(cleanup.options.signal, undefined)
  assertNoListeners(fixture.signals)
})

test("no-build requires scanned IDs and never rebuilds or pulls after scan", async () => {
  const fixture = fakeRunner()
  assert.equal(
    await fixture.invoke({ args: ["--no-build"], environment: scanned }),
    0
  )
  assert.equal(
    fixture.calls.some((call) => stage(call) === "build"),
    false
  )
  for (const environment of [
    {},
    { RR_INTEGRATION_POSTGRES_IMAGE_ID: postgresId },
    { ...scanned, RR_INTEGRATION_REDIS_IMAGE_ID: "tag:latest" },
  ]) {
    const invalid = fakeRunner()
    await assert.rejects(
      invalid.invoke({ args: ["--no-build"], environment }),
      /both exact scanned/u
    )
    assert.equal(invalid.calls.length, 0)
  }
})

for (const resource of ["ps", "network", "volume"])
  test(`refuses existing ${resource} resources without building, starting or deleting`, async () => {
    const fixture = fakeRunner((call) =>
      stage(call) === resource ? "existing-owned-elsewhere" : undefined
    )
    await assert.rejects(fixture.invoke(), /already has resources/u)
    assert.equal(
      fixture.calls.some((call) =>
        ["build", "up", "down"].includes(stage(call))
      ),
      false
    )
    assertNoListeners(fixture.signals)
  })

for (const failedStage of ["network", "build", "image"])
  test(`does not clean another project after ${failedStage} failure before startup`, async () => {
    const fixture = fakeRunner((call) => {
      if (stage(call) === failedStage) throw new Error("fixture failure")
    })
    await assert.rejects(fixture.invoke(), /fixture failure/u)
    assert.equal(
      fixture.calls.some((call) => stage(call) === "down"),
      false
    )
    assertNoListeners(fixture.signals)
  })

test("rejects malformed image ID or post-scan tag substitution before startup", async () => {
  for (const imageId of ["latest", `sha256:${"f".repeat(64)}`]) {
    const fixture = fakeRunner((call) =>
      stage(call) === "image" ? imageId : undefined
    )
    await assert.rejects(
      fixture.invoke({ args: ["--no-build"], environment: scanned }),
      /scanned identity/u
    )
    assert.equal(
      fixture.calls.some((call) => ["up", "down"].includes(stage(call))),
      false
    )
  }
})

for (const failedStage of ["up", "inspect", "tests"])
  test(`cleans only after attempted startup when ${failedStage} fails`, async () => {
    const fixture = fakeRunner((call) => {
      if (stage(call) === failedStage) throw new Error("fixture failure")
    })
    await assert.rejects(fixture.invoke(), /fixture failure/u)
    assert.equal(stage(fixture.calls.at(-1)), "down")
    assertNoListeners(fixture.signals)
  })

test("rejects changed runtime image or invalid container identity before integration tests", async () => {
  for (const broken of ["container", "image"]) {
    const fixture = fakeRunner((call) => {
      if (broken === "container" && call.args.includes("--quiet")) return ""
      if (broken === "image" && stage(call) === "inspect")
        return `sha256:${"f".repeat(64)}`
    })
    await assert.rejects(fixture.invoke(), /identity/u)
    assert.equal(
      fixture.calls.some((call) => stage(call) === "tests"),
      false
    )
    assert.equal(stage(fixture.calls.at(-1)), "down")
  }
})

test("cleanup failure fails a successful test and preserves the primary test failure", async () => {
  for (const testFails of [false, true]) {
    const fixture = fakeRunner((call) => {
      if (stage(call) === "tests" && testFails) throw new Error("test failure")
      if (stage(call) === "down") throw new Error("cleanup failure")
    })
    await assert.rejects(
      fixture.invoke(),
      testFails ? /test failure/u : /cleanup failure/u
    )
  }
})

test("rejects missing, public or incorrectly mapped runtime ports before tests and cleans startup", async () => {
  for (const bindings of [
    { "5432/tcp": [] },
    { "5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "55432" }] },
    { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "5432" }] },
  ]) {
    const fixture = fakeRunner((call) =>
      call.args.includes("{{json .NetworkSettings.Ports}}")
        ? JSON.stringify(bindings)
        : undefined
    )
    await assert.rejects(fixture.invoke(), /loopback port/u)
    assert.equal(
      fixture.calls.some((call) => stage(call) === "tests"),
      false
    )
    assert.equal(stage(fixture.calls.at(-1)), "down")
  }
})

for (const signal of ["SIGINT", "SIGTERM"])
  test(`${signal} cancels active work once and still runs uncancelled cleanup`, async () => {
    const fixture = fakeRunner((call, _calls, signals) => {
      if (stage(call) !== "tests") return
      signals.emit(signal)
      signals.emit(signal)
      assert.equal(call.options.signal.aborted, true)
      throw new Error("cancelled")
    })
    assert.equal(await fixture.invoke(), signal === "SIGINT" ? 130 : 143)
    assert.equal(stage(fixture.calls.at(-1)), "down")
    assert.equal(fixture.calls.at(-1).options.signal, undefined)
    assertNoListeners(fixture.signals)
  })

test("signal before startup prevents startup and cleanup", async () => {
  const fixture = fakeRunner((call, _calls, signals) => {
    if (stage(call) === "image") signals.emit("SIGTERM")
  })
  assert.equal(await fixture.invoke(), 143)
  assert.equal(
    fixture.calls.some((call) => ["up", "down"].includes(stage(call))),
    false
  )
})

const fakeChild = () => {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  const timers = new Map()
  const kills = []
  const spawns = []
  let nextTimer = 0
  const invoke = (options = {}) =>
    runIntegrationCommand("fixture", ["read-only"], {
      environment: {},
      capture: true,
      spawnProcess: (...args) => {
        spawns.push(args)
        return child
      },
      terminateProcess: (target, signal) => {
        assert.equal(target, child)
        kills.push(signal)
      },
      schedule: (callback, ms) => {
        const id = ++nextTimer
        timers.set(id, { callback, ms })
        return id
      },
      cancelTimer: (id) => timers.delete(id),
      ...options,
    })
  return { child, timers, kills, spawns, invoke }
}

test("child runner captures bounded output and clears timers on success", async () => {
  const fixture = fakeChild()
  const result = fixture.invoke()
  fixture.child.stdout.emit("data", "  verified\n")
  fixture.child.emit("close", 0)
  assert.equal(await result, "verified")
  assert.equal(fixture.timers.size, 0)
  assert.equal(fixture.spawns[0][2].detached, process.platform !== "win32")
})

test("deadline and cancellation terminate actual child groups then escalate before settlement", async () => {
  for (const mode of ["timeout", "abort", "output"]) {
    const fixture = fakeChild()
    const controller = new AbortController()
    const result = fixture.invoke({ signal: controller.signal })
    const rejected = assert.rejects(result, /timed out|cancelled|exceeded/u)
    if (mode === "timeout") fixture.timers.get(1).callback()
    if (mode === "abort") {
      controller.abort("private reason")
      controller.abort()
    }
    if (mode === "output") fixture.child.stdout.emit("data", "x".repeat(65_537))
    assert.deepEqual(fixture.kills, ["SIGTERM"])
    assert.equal(fixture.timers.get(2).ms, 5_000)
    fixture.timers.get(2).callback()
    assert.deepEqual(fixture.kills, ["SIGTERM", "SIGKILL"])
    fixture.child.emit("close", null)
    await rejected
    assert.equal(fixture.kills.at(-1), "SIGKILL")
    assert.equal(fixture.timers.size, 0)
  }
})

test("early wrapper exit after cancellation still kills remaining group before cleanup", async () => {
  const fixture = fakeChild()
  const controller = new AbortController()
  const result = fixture.invoke({ signal: controller.signal })
  controller.abort()
  fixture.child.emit("close", 0)
  await assert.rejects(result, /cancelled/u)
  assert.deepEqual(fixture.kills, ["SIGTERM", "SIGKILL"])
})

test("capture limit counts UTF-8 bytes and discards later output without buffering", async () => {
  const fixture = fakeChild()
  const result = fixture.invoke()
  fixture.child.stdout.emit("data", "é".repeat(32_769))
  assert.deepEqual(fixture.kills, ["SIGTERM"])
  for (let index = 0; index < 10; index += 1)
    fixture.child.stdout.emit("data", Buffer.alloc(1_048_576))
  // Even an uncoercible late chunk must be ignored after cancellation.
  fixture.child.stdout.emit("data", {
    toString: () => {
      throw new Error("Late output was buffered")
    },
  })
  fixture.child.emit("close", null)
  await assert.rejects(result, /exceeded/u)
  assert.equal(fixture.timers.size, 0)
})

test("child start and nonzero failures are fixed and redacted", async () => {
  for (const event of ["error", "close"]) {
    const fixture = fakeChild()
    const result = fixture.invoke()
    fixture.child.emit(
      event,
      event === "error" ? new Error("private fixture reason") : 1
    )
    await assert.rejects(
      result,
      (error) =>
        !error.message.includes("private") && /command/u.test(error.message)
    )
    assert.equal(fixture.timers.size, 0)
  }
})

test("pre-aborted child command never spawns", async () => {
  const fixture = fakeChild()
  await assert.rejects(
    fixture.invoke({ signal: AbortSignal.abort() }),
    /cancelled/u
  )
  assert.equal(fixture.spawns.length, 0)
})

test("real local child succeeds and process-group deadline is enforced", async () => {
  assert.equal(
    await runIntegrationCommand(
      process.execPath,
      ["-e", "process.stdout.write('ok')"],
      { environment: {}, capture: true }
    ),
    "ok"
  )
  await assert.rejects(
    runIntegrationCommand(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { environment: {}, timeoutMs: 30 }
    ),
    /timed out/u
  )
})

test("installed Medusa loadEnv cannot re-enable explicitly disabled external providers from synthetic env files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rr-integration-env-proof-"))
  const backendRequire = createRequire(
    new URL("../backend/package.json", import.meta.url)
  )
  const utils = backendRequire.resolve("@medusajs/utils")
  const keys = [
    "RESEND_API_KEY",
    "RESEND_FROM_EMAIL",
    "RESEND_FROM",
    "MEILISEARCH_HOST",
    "MEILISEARCH_ADMIN_KEY",
    "MEILISEARCH_CANDIDATE_INDEX",
    "MINIO_ENDPOINT",
    "MINIO_ACCESS_KEY",
    "MINIO_SECRET_KEY",
    "MINIO_FILE_URL",
    "TAX_RATE_LOOKUP_API_KEY",
    "STRIPE_API_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_LIFECYCLE_WEBHOOK_SECRET",
    "STRIPE_LIFECYCLE_WEBHOOK_SECRET_PREVIOUS",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "OTEL_EXPORTER_OTLP_HEADERS",
  ]
  const inherited = Object.fromEntries(
    keys.map((key) => [key, "synthetic_external_value"])
  )
  const safe = integrationEnvironment(inherited)
  try {
    await writeFile(
      join(directory, ".env"),
      keys.map((key) => `${key}=synthetic_from_env_file`).join("\n"),
      { mode: 0o600 }
    )
    await writeFile(
      join(directory, ".env.test"),
      "OTEL_SDK_DISABLED=false\nTAX_RATE_LOOKUP_PROVIDER=external\nTAX_RATE_LOOKUP_MODE=external\n",
      { mode: 0o600 }
    )
    const script = `require(${JSON.stringify(utils)}).loadEnv("test", ${JSON.stringify(directory)});process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify([...keys, "OTEL_SDK_DISABLED", "OTEL_TRACES_EXPORTER", "OTEL_METRICS_EXPORTER", "OTEL_LOGS_EXPORTER", "TAX_RATE_LOOKUP_PROVIDER", "TAX_RATE_LOOKUP_MODE"])}.map(key=>[key,process.env[key]]))))`
    const result = JSON.parse(
      await runIntegrationCommand(process.execPath, ["-e", script], {
        environment: safe,
        capture: true,
      })
    )
    for (const key of keys) assert.equal(result[key], "", key)
    assert.equal(result.OTEL_SDK_DISABLED, "true")
    for (const key of [
      "OTEL_TRACES_EXPORTER",
      "OTEL_METRICS_EXPORTER",
      "OTEL_LOGS_EXPORTER",
    ])
      assert.equal(result[key], "none")
    assert.equal(result.TAX_RATE_LOOKUP_PROVIDER, "taxrate_io")
    assert.equal(result.TAX_RATE_LOOKUP_MODE, "zip")
  } finally {
    await rm(directory, { recursive: true })
  }
})
