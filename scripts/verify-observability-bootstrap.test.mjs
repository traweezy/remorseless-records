import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { EventEmitter } from "node:events"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { runInNewContext } from "node:vm"
import test, { after } from "node:test"

const bootstrapUrl = new URL(
  "../backend/scripts/observability-register.cjs",
  import.meta.url
)
const bootstrapPath = fileURLToPath(bootstrapUrl)
const bootstrapSource = await readFile(bootstrapUrl, "utf8")
const require = createRequire(bootstrapUrl)
const sdkRequire = createRequire(require.resolve("@opentelemetry/sdk-node"))
const api = require("@opentelemetry/api")
const { AsyncLocalStorageContextManager } = sdkRequire(
  "@opentelemetry/context-async-hooks"
)
const { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } =
  sdkRequire("@opentelemetry/sdk-trace-base")
const {
  MeterProvider,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
  AggregationTemporality,
} = sdkRequire("@opentelemetry/sdk-metrics")

// Import without starting the global SDK. Each test supplies its own in-memory
// provider, and no test imports a live database/Redis client or exporter.
const previousDisabled = process.env.OTEL_SDK_DISABLED
process.env.OTEL_SDK_DISABLED = "true"
const bootstrap = require(bootstrapPath)
if (previousDisabled === undefined) delete process.env.OTEL_SDK_DISABLED
else process.env.OTEL_SDK_DISABLED = previousDisabled
const contextManager = new AsyncLocalStorageContextManager().enable()
api.context.setGlobalContextManager(contextManager)
after(() => {
  api.context.disable()
  contextManager.disable()
})

const fixture = (t) => {
  const exporter = new InMemorySpanExporter()
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  })
  const instrumentations = bootstrap.createInstrumentations()
  for (const instrumentation of instrumentations)
    instrumentation.setTracerProvider(provider)
  t.after(async () => {
    for (const instrumentation of instrumentations) instrumentation.disable()
    await provider.shutdown()
  })
  const get = (name) =>
    instrumentations.find(
      (item) =>
        item.instrumentationName === `@opentelemetry/instrumentation-${name}`
    )
  return { exporter, provider, instrumentations, get }
}

const assertPrivateValuesAbsent = (span) => {
  const payload = JSON.stringify({
    name: span.name,
    attributes: span.attributes,
    events: span.events,
    links: span.links,
    status: span.status,
  })
  assert.doesNotMatch(
    payload,
    /private|SELECT|customer|secret|password|stack-marker/u
  )
}

const metricFixture = (t) => {
  const input = fixture(t)
  const metricExporter = new InMemoryMetricExporter(
    AggregationTemporality.CUMULATIVE
  )
  const reader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 60_000,
  })
  const meterProvider = new MeterProvider({ readers: [reader] })
  input.get("pg").setMeterProvider(meterProvider)
  t.after(() => meterProvider.shutdown())
  const collect = async () => {
    await meterProvider.forceFlush()
    return metricExporter
      .getMetrics()
      .at(-1)
      .scopeMetrics.flatMap((scope) => scope.metrics)
  }
  return { ...input, meterProvider, reader, collect }
}

test("allowed real instrumentations retain their explicit privacy configuration", (t) => {
  const { instrumentations, get } = fixture(t)
  assert.deepEqual(
    instrumentations.map((item) => item.instrumentationName).sort(),
    [...bootstrap.ALLOWED_INSTRUMENTATIONS].sort()
  )
  assert.equal(get("knex").getConfig().maxQueryLength, 0)
  assert.equal(get("runtime-node").getConfig().captureUncaughtException, false)
  for (const key of [
    "enhancedDatabaseReporting",
    "enableTraceContextPropagation",
    "addSqlCommenterCommentToQueries",
  ]) {
    assert.equal(get("pg").getConfig()[key], false)
  }
  for (const name of ["redis", "ioredis"]) {
    assert.equal(
      get(name)
        .getConfig()
        .dbStatementSerializer("SET", ["private-key", "secret-value"]),
      "set"
    )
  }
})

test("real SDK spans filter legacy and stable attributes, updates, errors, events and links", async (t) => {
  const { exporter, provider, get } = fixture(t)
  const linkContext = {
    traceId: "1".repeat(32),
    spanId: "2".repeat(16),
    traceFlags: 1,
  }
  const parent = provider.getTracer("project").startSpan("project.operation")
  const parentContext = api.trace.setSpan(api.ROOT_CONTEXT, parent)
  const startTime = [1_700_000_000, 0]
  const endTime = [1_700_000_000, 25_000_000]
  const span = get("pg").tracer.startSpan(
    "pg.query:SELECT private-database",
    {
      kind: api.SpanKind.CLIENT,
      startTime,
      attributes: {
        "db.system": "postgresql",
        "db.system.name": "postgresql",
        "db.operation": "SELECT",
        "db.operation.name": "SELECT",
        "db.statement": "SELECT secret FROM customer",
        "db.query.text": "SELECT secret FROM customer",
        "db.query.parameter.0": "private-bind",
        "server.address": "private-host",
        "db.namespace": "private-database",
        "db.user": "private-user",
        "db.response.returned_rows": 2,
      },
      links: [
        {
          context: linkContext,
          attributes: { "db.operation.name": "select", password: "secret" },
        },
      ],
    },
    parentContext
  )
  assert.equal(span.isRecording(), true)
  assert.equal(span.spanContext().traceId, parent.spanContext().traceId)
  assert.equal(span.setAttribute("db.query.text", "private-update"), span)
  assert.equal(
    span.setAttributes({ "db.operation.name": "update", password: "secret" }),
    span
  )
  assert.equal(
    span.setStatus({
      code: api.SpanStatusCode.ERROR,
      message: "private-error",
    }),
    span
  )
  assert.equal(span.updateName("private-renamed-span"), span)
  assert.equal(span.addEvent("private-event", { password: "secret" }), span)
  span.recordException({ message: "private-error", stack: "stack-marker" })
  assert.equal(
    span.addLink({ context: linkContext, attributes: { password: "secret" } }),
    span
  )
  assert.equal(
    span.addLinks([
      { context: linkContext, attributes: { password: "secret" } },
    ]),
    span
  )
  span.end(endTime)
  assert.equal(span.isRecording(), false)
  await provider.forceFlush()
  const [recorded] = exporter.getFinishedSpans()
  assert.equal(recorded.name, "pg.operation")
  assert.equal(recorded.kind, api.SpanKind.CLIENT)
  assert.equal(recorded.parentSpanContext.spanId, parent.spanContext().spanId)
  assert.deepEqual(recorded.duration, [0, 25_000_000])
  assert.deepEqual(recorded.status, { code: api.SpanStatusCode.ERROR })
  assert.deepEqual(recorded.events, [])
  assert.equal(recorded.links.length, 3)
  assert.deepEqual(recorded.links[0].context, linkContext)
  assert.deepEqual(recorded.links[0].attributes, {
    "db.operation.name": "select",
  })
  assert.deepEqual(recorded.attributes, {
    "db.system": "postgresql",
    "db.system.name": "postgresql",
    "db.operation": "select",
    "db.operation.name": "update",
    "db.response.returned_rows": 2,
  })
  assertPrivateValuesAbsent(recorded)
  parent.end()
})

test("active-span overloads preserve context and do not wrap project spans", async (t) => {
  const { exporter, provider, get } = fixture(t)
  const projectTracer = provider.getTracer("project")
  const parent = projectTracer.startSpan("project.operation", {
    attributes: { "project.marker": "untouched" },
  })
  const parentContext = api.trace.setSpan(api.ROOT_CONTEXT, parent)
  const tracer = get("redis").tracer
  for (const options of [[], [{}], [{}, parentContext]]) {
    await api.context.with(parentContext, () =>
      tracer.startActiveSpan("private-command", ...options, async (span) => {
        assert.equal(api.trace.getActiveSpan(), span)
        await Promise.resolve()
        assert.equal(api.trace.getActiveSpan(), span)
        span.setAttributes({
          "db.query.text": "get",
          "db.statement": "get",
          "db.operation.name": "PIPELINE GET",
        })
        span.end()
      })
    )
  }
  parent.end()
  await provider.forceFlush()
  const spans = exporter.getFinishedSpans()
  for (const span of spans.slice(0, 3)) {
    assert.equal(span.parentSpanContext.spanId, parent.spanContext().spanId)
    assert.deepEqual(span.attributes, {
      "db.query.text": "get",
      "db.statement": "get",
      "db.operation.name": "pipeline get",
    })
    assertPrivateValuesAbsent(span)
  }
  assert.equal(spans[3].name, "project.operation")
  assert.deepEqual(spans[3].attributes, { "project.marker": "untouched" })
})

test("real pg patch forwards queries once without propagation writes and exports no SQL/error text", async (t) => {
  const { exporter, provider, get } = fixture(t)
  const calls = []
  const error = new Error("private-error for customer password")
  class Client {
    connectionParameters = {
      database: "private-db",
      host: "private-host",
      port: 5432,
      user: "private-user",
    }
    query(...args) {
      calls.push(args)
      return Promise.reject(error)
    }
    connect() {
      return Promise.resolve()
    }
  }
  const definition = get("pg")
    .getModuleDefinitions()
    .find((item) => item.name === "pg")
  definition.patch({ Client }, "8.22.0")
  t.after(() => definition.unpatch({ Client }))
  const query = {
    text: "SELECT secret FROM customer WHERE password = $1",
    values: ["private-bind"],
  }
  await assert.rejects(new Client().query(query), (actual) => actual === error)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], query)
  assert.deepEqual(query.values, ["private-bind"])
  await provider.forceFlush()
  const spans = exporter.getFinishedSpans()
  assert.equal(spans.length, 1)
  assert.equal(spans[0].status.code, api.SpanStatusCode.ERROR)
  assertPrivateValuesAbsent(spans[0])
})

test("real ioredis patch retains command-only query text and original errors", async (t) => {
  const { exporter, provider, get } = fixture(t)
  const error = new Error("private-error from private-host")
  class Redis {
    options = { host: "private-host", port: 6379 }
    sendCommand(command) {
      queueMicrotask(() => command.reject(error))
      return command.promise
    }
    connect() {
      return this
    }
  }
  const instrumentation = get("ioredis")
  const definition = instrumentation.getModuleDefinitions()[0]
  definition.patch(Redis, "5.10.0")
  t.after(() => definition.unpatch(Redis))
  const parent = provider.getTracer("project").startSpan("project.operation")
  const command = {
    name: "set",
    args: ["private-key", "secret-value"],
    ...Promise.withResolvers(),
  }
  await api.context.with(
    api.trace.setSpan(api.ROOT_CONTEXT, parent),
    async () => {
      await assert.rejects(
        new Redis().sendCommand(command),
        (actual) => actual === error
      )
    }
  )
  await provider.forceFlush()
  const [span] = exporter.getFinishedSpans()
  assert.equal(span.parentSpanContext.spanId, parent.spanContext().spanId)
  assert.equal(
    span.attributes["db.query.text"] ?? span.attributes["db.statement"],
    "set"
  )
  assert.equal(span.status.code, api.SpanStatusCode.ERROR)
  assertPrivateValuesAbsent(span)
  parent.end()
})

test("real Redis composite propagates the bounded provider into its client patch", async (t) => {
  const { exporter, provider, get } = fixture(t)
  const error = new Error("private-redis-error")
  const calls = []
  class Client {
    options = { socket: { host: "private-host", port: 6379 }, database: 0 }
    sendCommand(command) {
      calls.push(command)
      return Promise.reject(error)
    }
    connect() {
      return Promise.resolve(this)
    }
  }
  const definition = get("redis")
    .getModuleDefinitions()
    .find((item) => item.name === "@redis/client")
  const clientFile = definition.files.find(
    (item) => item.name === "@redis/client/dist/lib/client/index.js"
  )
  const module = { default: Client }
  clientFile.patch(module, "6.0.0")
  t.after(() => clientFile.unpatch(module))
  const command = ["GET", "private-key"]
  await assert.rejects(
    new Client().sendCommand(command),
    (actual) => actual === error
  )
  assert.deepEqual(calls, [command])
  await provider.forceFlush()
  const [span] = exporter.getFinishedSpans()
  assert.equal(
    span.attributes["db.query.text"] ?? span.attributes["db.statement"],
    "get"
  )
  assert.equal(span.status.code, api.SpanStatusCode.ERROR)
  assertPrivateValuesAbsent(span)
})

test("real Knex runner retains operation and original query but never exports SQL or identifiers", async (t) => {
  const { exporter, provider, get } = fixture(t)
  const connection = {
    host: "private-host",
    database: "private-db",
    user: "private-user",
  }
  const calls = []
  const result = { count: 2 }
  class Runner {
    builder = { _single: { table: "private-table" } }
    client = {
      config: { connection },
      connectionSettings: connection,
      driverName: "pg",
    }
    query(query) {
      calls.push(query)
      return Promise.resolve(result)
    }
  }
  const definition = get("knex").getModuleDefinitions()[0]
  const runnerFile = definition.files.find(
    (item) => item.name === "knex/lib/execution/runner.js"
  )
  runnerFile.patch(Runner, "3.1.0")
  t.after(() => runnerFile.unpatch(Runner))
  const query = {
    method: "select",
    sql: "SELECT secret FROM customer",
    bindings: ["private-bind"],
  }
  assert.equal(await new Runner().query(query), result)
  assert.deepEqual(calls, [query])
  await provider.forceFlush()
  const [span] = exporter.getFinishedSpans()
  assert.equal(
    span.attributes["db.operation.name"] ?? span.attributes["db.operation"],
    "select"
  )
  assertPrivateValuesAbsent(span)
})

test("unknown operations and unsafe attribute values fail closed", async (t) => {
  const { exporter, provider, get } = fixture(t)
  const span = get("redis").tracer.startSpan("private-name", {
    attributes: {
      "db.query.text": "private-token",
      "db.statement": "SET private-key secret",
      "db.operation.name": "private-operation",
      "db.operation": { password: "secret" },
      "db.system.name": "private-system",
      "db.response.returned_rows": -1,
      "db.redis.database_index": Number.NaN,
    },
  })
  span.setStatus({ code: 500, message: "private-error" })
  span.end()
  await provider.forceFlush()
  const [recorded] = exporter.getFinishedSpans()
  assert.deepEqual(recorded.attributes, {
    "db.query.text": "unknown",
    "db.statement": "unknown",
    "db.operation.name": "unknown",
    "db.operation": "unknown",
  })
  assert.deepEqual(recorded.status, { code: api.SpanStatusCode.UNSET })
  assertPrivateValuesAbsent(recorded)
})

test("real Pg duration and pool metrics retain values and bounded labels without identifiers", async (t) => {
  const { get, collect } = metricFixture(t)
  const error = Object.assign(new Error("private-error"), {
    code: "private-code",
  })
  class Client {
    connectionParameters = {
      database: "private-db",
      host: "private-host",
      port: 5432,
      user: "private-user",
    }
    query(_query, callback) {
      queueMicrotask(() => callback(error))
    }
    connect() {
      return Promise.resolve()
    }
  }
  class Pool extends EventEmitter {
    options = { database: "private-db", host: "private-host", port: 5432 }
    totalCount = 3
    idleCount = 1
    waitingCount = 2
    connect() {
      this.emit("acquire")
      return Promise.resolve({})
    }
  }
  const definitions = get("pg").getModuleDefinitions()
  const clientDefinition = definitions.find((item) => item.name === "pg")
  const poolDefinition = definitions.find((item) => item.name === "pg-pool")
  clientDefinition.patch({ Client }, "8.22.0")
  poolDefinition.patch(Pool, "3.12.0")
  t.after(() => {
    clientDefinition.unpatch({ Client })
    poolDefinition.unpatch(Pool)
  })
  await new Promise((resolve) =>
    new Client().query("SELECT secret FROM customer", (actual) => {
      assert.equal(actual, error)
      resolve()
    })
  )
  await new Pool().connect()
  const measurements = await collect()
  assert.doesNotMatch(
    JSON.stringify(measurements),
    /private|secret|customer|db\.namespace|server\.address/u
  )
  const duration = measurements.find(
    (item) => item.descriptor.name === "db.client.operation.duration"
  )
  assert.equal(duration.descriptor.unit, "s")
  assert.equal(duration.dataPoints[0].value.count, 1)
  assert.ok(duration.dataPoints[0].value.sum >= 0)
  assert.equal(duration.dataPoints[0].attributes["db.operation.name"], "select")
  assert.equal(duration.dataPoints[0].attributes["error.type"], "error")
  const connections = measurements.find(
    (item) => item.descriptor.name === "db.client.connection.count"
  )
  assert.equal(connections.descriptor.unit, "{connection}")
  assert.deepEqual(
    connections.dataPoints
      .map((point) => [
        point.attributes["db.client.connection.state"],
        point.value,
      ])
      .sort(),
    [
      ["idle", 1],
      ["used", 2],
    ]
  )
  const pending = measurements.find(
    (item) => item.descriptor.name === "db.client.connection.pending_requests"
  )
  assert.equal(pending.dataPoints[0].value, 2)
  assert.deepEqual(pending.dataPoints[0].attributes, {
    "db.client.connection.pool.name": "pool_1",
  })
})

test("two real Pg pools preserve upstream series/deltas with anonymous connection groups", async (t) => {
  const bounded = metricFixture(t)
  const original = metricFixture(t)
  const { PgInstrumentation } = require("@opentelemetry/instrumentation-pg")
  const raw = new PgInstrumentation({ ignoreConnectSpans: true })
  raw.setMeterProvider(original.meterProvider)
  t.after(() => raw.disable())
  const exercise = async (instrumentation) => {
    class Pool extends EventEmitter {
      constructor(host, total, idle, pending) {
        super()
        this.options = { host, port: 5432, database: "private-db" }
        this.totalCount = total
        this.idleCount = idle
        this.waitingCount = pending
      }
      connect() {
        this.emit("acquire")
        return Promise.resolve({})
      }
    }
    const definition = instrumentation
      .getModuleDefinitions()
      .find((item) => item.name === "pg-pool")
    definition.patch(Pool, "3.12.0")
    t.after(() => definition.unpatch(Pool))
    await new Pool("private-a", 3, 1, 2).connect()
    await new Pool("private-b", 5, 2, 1).connect()
  }
  await exercise(bounded.get("pg"))
  await exercise(raw)
  const normalize = (measurements, anonymize) =>
    measurements
      .filter((item) =>
        item.descriptor.name.startsWith("db.client.connection.")
      )
      .flatMap((item) =>
        item.dataPoints.map((point) => ({
          metric: item.descriptor.name,
          value: point.value,
          attributes: {
            ...point.attributes,
            "db.client.connection.pool.name": anonymize
              ? point.attributes["db.client.connection.pool.name"].startsWith(
                  "private-a"
                )
                ? "pool_1"
                : "pool_2"
              : point.attributes["db.client.connection.pool.name"],
          },
        }))
      )
  const boundedMeasurements = normalize(await bounded.collect(), false)
  const rawMeasurements = normalize(await original.collect(), true)
  assert.deepEqual(boundedMeasurements, rawMeasurements)
  assert.deepEqual(
    [
      ...new Set(
        boundedMeasurements.map(
          (point) => point.attributes["db.client.connection.pool.name"]
        )
      ),
    ],
    ["pool_1", "pool_2"]
  )
  assert.doesNotMatch(JSON.stringify(boundedMeasurements), /private/u)
  // Upstream 0.69/0.73 keep one delta baseline across pools. Preserve that
  // behavior; these are not a trustworthy aggregate physical-pool inventory.
  assert.equal(
    rawMeasurements.find(
      (point) =>
        point.metric.endsWith("pending_requests") &&
        point.attributes["db.client.connection.pool.name"] === "pool_2"
    ).value,
    -1
  )
})

test("anonymous Pg connection groups are capped and reset with their meter", async (t) => {
  const { get, collect, meterProvider } = metricFixture(t)
  const pg = get("pg")
  const counter = pg.meter.createUpDownCounter("test.pool.groups")
  for (let index = 0; index < 35; index += 1) {
    counter.add(1, {
      "db.client.connection.pool.name": `private-pool-${index}`,
    })
  }
  const measurements = await collect()
  const points = measurements.find(
    (item) => item.descriptor.name === "test.pool.groups"
  ).dataPoints
  assert.equal(points.length, 33)
  assert.equal(
    points.reduce((total, point) => total + point.value, 0),
    35
  )
  assert.equal(
    points.find(
      (point) => point.attributes["db.client.connection.pool.name"] === "other"
    ).value,
    3
  )
  assert.doesNotMatch(JSON.stringify(points), /private/u)
  pg.setMeterProvider(meterProvider)
  pg.meter
    .createUpDownCounter("test.pool.reset")
    .add(2, { "db.client.connection.pool.name": "private-new-pool" })
  const reset = (await collect()).find(
    (item) => item.descriptor.name === "test.pool.reset"
  ).dataPoints
  assert.deepEqual(reset[0].attributes, {
    "db.client.connection.pool.name": "pool_1",
  })
  assert.equal(reset[0].value, 2)
})

test("Pg meter facade preserves all instrument kinds and async callback add/remove semantics", async (t) => {
  const { get, collect } = metricFixture(t)
  const meter = get("pg").meter
  const attributes = {
    "db.operation.name": "select",
    "db.namespace": "private-db",
  }
  meter
    .createCounter("test.counter", { unit: "{call}" })
    .add(3, attributes, api.ROOT_CONTEXT)
  const upDown = meter.createUpDownCounter("test.updown")
  upDown.add(5, attributes)
  upDown.add(-2, attributes)
  meter
    .createHistogram("test.histogram", { unit: "s" })
    .record(0.25, attributes)
  meter.createGauge("test.gauge").record(7, attributes)
  let calls = 0
  const callback = async (result) => {
    await Promise.resolve()
    calls += 1
    result.observe(9, attributes)
  }
  const observables = [
    meter.createObservableCounter("test.observable.counter"),
    meter.createObservableUpDownCounter("test.observable.updown"),
    meter.createObservableGauge("test.observable.gauge"),
  ]
  for (const observable of observables) observable.addCallback(callback)
  const batch = meter.createObservableGauge("test.batch")
  let batchCalls = 0
  const batchCallback = async (result) => {
    await Promise.resolve()
    batchCalls += 1
    result.observe(batch, 11, attributes)
  }
  meter.addBatchObservableCallback(batchCallback, [batch])
  const measurements = await collect()
  const values = Object.fromEntries(
    measurements
      .filter((item) => item.descriptor.name.startsWith("test."))
      .map((item) => [item.descriptor.name, item.dataPoints[0].value])
  )
  assert.equal(values["test.counter"], 3)
  assert.equal(values["test.updown"], 3)
  assert.equal(values["test.gauge"], 7)
  assert.equal(values["test.histogram"].sum, 0.25)
  assert.equal(values["test.batch"], 11)
  for (const suffix of ["counter", "updown", "gauge"])
    assert.equal(values[`test.observable.${suffix}`], 9)
  assert.doesNotMatch(JSON.stringify(measurements), /private|db\.namespace/u)
  assert.equal(calls, 3)
  assert.equal(batchCalls, 1)
  for (const observable of observables) observable.removeCallback(callback)
  meter.removeBatchObservableCallback(batchCallback, [batch])
  await collect()
  assert.equal(calls, 3)
  assert.equal(batchCalls, 1)
  observables[0].addCallback(callback)
  meter.addBatchObservableCallback(batchCallback, [batch])
  await collect()
  assert.equal(calls, 4)
  assert.equal(batchCalls, 2)
  observables[0].removeCallback(callback)
  meter.removeBatchObservableCallback(batchCallback, [batch])
})

test("runtime meter keeps native heap and resource labels and disables collectors", async (t) => {
  const { get, collect, meterProvider, reader } = metricFixture(t)
  const heapScrape = t.mock.method(require("node:v8"), "getHeapSpaceStatistics")
  const runtime = get("runtime-node")
  runtime.setMeterProvider(meterProvider)
  const measurements = await collect()
  const heap = measurements.find(
    (item) => item.descriptor.name === "v8js.memory.heap.used"
  )
  assert.equal(heap.descriptor.unit, "By")
  assert.ok(heap.dataPoints.some((point) => point.value > 0))
  assert.ok(
    heap.dataPoints.every(
      (point) => typeof point.attributes["v8js.heap.space.name"] === "string"
    )
  )
  const resources = measurements.find(
    (item) => item.descriptor.name === "v8js.resource.active"
  )
  assert.ok(
    resources.dataPoints.every(
      (point) => typeof point.attributes["v8js.resource.type"] === "string"
    )
  )
  assert.equal(process.listenerCount("uncaughtExceptionMonitor"), 0)
  const scrapeCount = heapScrape.mock.callCount()
  assert.ok(scrapeCount > 0)
  runtime.disable()
  await reader.collect()
  assert.equal(runtime.isEnabled(), false)
  assert.equal(heapScrape.mock.callCount(), scrapeCount)
})

const isolatedBootstrap = (environment, shutdown = () => Promise.resolve()) => {
  const runtime = new EventEmitter()
  runtime.env = { ...environment }
  const instances = []
  class NodeSDK {
    constructor(options) {
      this.options = options
      instances.push(this)
    }
    start() {
      this.started = true
    }
    shutdown = shutdown
  }
  class Instrumentation {
    setTracerProvider() {}
    setMeterProvider() {}
  }
  const module = { exports: {} }
  runInNewContext(
    bootstrapSource,
    {
      module,
      process: runtime,
      require: (name) => {
        if (name === "@opentelemetry/api") return api
        if (name === "@opentelemetry/sdk-node") return { NodeSDK }
        const exports = {
          "@opentelemetry/instrumentation-ioredis": "IORedisInstrumentation",
          "@opentelemetry/instrumentation-knex": "KnexInstrumentation",
          "@opentelemetry/instrumentation-pg": "PgInstrumentation",
          "@opentelemetry/instrumentation-redis": "RedisInstrumentation",
          "@opentelemetry/instrumentation-runtime-node":
            "RuntimeNodeInstrumentation",
        }
        assert.ok(exports[name], "Unexpected bootstrap dependency")
        return { [exports[name]]: Instrumentation }
      },
    },
    { filename: bootstrapPath }
  )
  return { runtime, instances }
}

test("disabled preload constructs no SDK or shutdown handler", () => {
  for (const value of ["true", "TRUE", "1"]) {
    const { runtime, instances } = isolatedBootstrap({
      OTEL_SDK_DISABLED: value,
    })
    assert.equal(instances.length, 0)
    assert.equal(runtime.listenerCount("beforeExit"), 0)
  }
})

test("shutdown executes once and observes rejection without logging raw errors", async () => {
  let calls = 0
  const { runtime, instances } = isolatedBootstrap({}, () => {
    calls += 1
    return Promise.reject(new Error("private-shutdown-error"))
  })
  assert.equal(instances.length, 1)
  assert.equal(instances[0].started, true)
  assert.equal(instances[0].options.serviceName, "backend")
  runtime.emit("beforeExit")
  runtime.emit("beforeExit")
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls, 1)
})

test("real preload with exporters absent records no traces, opens no sockets and shuts down", () => {
  const script = `
    const assert = require("node:assert/strict")
    require("node:net").Socket.prototype.connect = () => { throw new Error("Network forbidden") }
    globalThis.fetch = () => { throw new Error("Network forbidden") }
    const { NodeSDK } = require("@opentelemetry/sdk-node")
    let shutdownCalls = 0
    const shutdown = NodeSDK.prototype.shutdown
    NodeSDK.prototype.shutdown = function () { shutdownCalls += 1; return shutdown.call(this) }
    const bootstrap = require(${JSON.stringify(bootstrapPath)})
    for (const key of ["OTEL_TRACES_EXPORTER", "OTEL_METRICS_EXPORTER", "OTEL_LOGS_EXPORTER"]) assert.equal(process.env[key], "none")
    const span = require("@opentelemetry/api").trace.getTracer("smoke").startSpan("smoke")
    assert.equal(span.isRecording(), false)
    span.end()
    assert.equal(process.listenerCount("uncaughtExceptionMonitor"), 0)
    process.once("beforeExit", () => { assert.equal(shutdownCalls, 1); process.stdout.write("preload-no-exporters-ok") })
  `
  const result = spawnSync(
    process.execPath,
    ["--input-type=commonjs", "-e", script],
    {
      cwd: fileURLToPath(new URL("../backend", import.meta.url)),
      env: { PATH: process.env.PATH, OTEL_NODE_RESOURCE_DETECTORS: "none" },
      encoding: "utf8",
      timeout: 10_000,
    }
  )
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, "preload-no-exporters-ok")
  assert.equal(result.stderr, "")
})
