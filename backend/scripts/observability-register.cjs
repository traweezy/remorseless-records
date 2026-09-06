"use strict"

const { context, metrics, trace } = require("@opentelemetry/api")
const {
  IORedisInstrumentation,
} = require("@opentelemetry/instrumentation-ioredis")
const { KnexInstrumentation } = require("@opentelemetry/instrumentation-knex")
const { PgInstrumentation } = require("@opentelemetry/instrumentation-pg")
const { RedisInstrumentation } = require("@opentelemetry/instrumentation-redis")
const {
  RuntimeNodeInstrumentation,
} = require("@opentelemetry/instrumentation-runtime-node")
const { NodeSDK } = require("@opentelemetry/sdk-node")

const ALLOWED_INSTRUMENTATIONS = new Set([
  "@opentelemetry/instrumentation-ioredis",
  "@opentelemetry/instrumentation-knex",
  "@opentelemetry/instrumentation-pg",
  "@opentelemetry/instrumentation-redis",
  "@opentelemetry/instrumentation-runtime-node",
])
const REDIS_COMMAND_PATTERN = /^[a-z][a-z0-9_]{0,31}$/u
const DATABASE_OPERATIONS = new Set(
  `unknown connect disconnect quit ping select insert update delete merge
  begin commit rollback savepoint release create alter drop truncate explain
  get set mget mset del unlink exists expire pexpire expireat pexpireat ttl pttl
  persist incr incrby incrbyfloat decr decrby append strlen getset getdel getex
  hget hset hmget hmset hgetall hdel hexists hincrby hincrbyfloat hkeys hvals hlen hscan
  lpush rpush lpop rpop blpop brpop lrange llen lindex lset lrem ltrim lmove blmove
  sadd srem smembers sismember scard spop srandmember sscan sunion sinter sdiff
  zadd zrem zrange zrangebyscore zrevrange zrevrangebyscore zscore zrank zrevrank
  zcard zcount zincrby zpopmin zpopmax bzpopmin bzpopmax zremrangebyrank zremrangebyscore zscan
  xadd xread xreadgroup xack xdel xlen xrange xrevrange xgroup xinfo xpending xclaim xautoclaim
  eval evalsha eval_ro evalsha_ro script fcall fcall_ro function
  multi exec discard watch unwatch pipeline scan keys type info dbsize time
  publish subscribe unsubscribe psubscribe punsubscribe`.split(/\s+/u)
)

const boundedOperation = (value) => {
  if (typeof value !== "string") return "unknown"
  const operation = value.trim().toLowerCase()
  const command = operation.replace(/^(?:multi|pipeline) /u, "")
  return DATABASE_OPERATIONS.has(command) ? operation : "unknown"
}

// Instrumentation options do not suppress SQL literals or exception messages.
// Filter before those values reach an SDK span, without wrapping the global
// provider or changing the application's deliberately bounded domain spans.
const boundedAttributes = (attributes, kind) => {
  const result = {}
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (key === "db.operation" || key === "db.operation.name") {
      result[key] = boundedOperation(value)
    } else if (key === "db.system" || key === "db.system.name") {
      if (
        ["redis", "postgresql", "mysql", "sqlite", "mssql", "oracle"].includes(
          value
        )
      ) {
        result[key] = value
      }
    } else if (
      kind === "redis" &&
      (key === "db.statement" || key === "db.query.text")
    ) {
      result[key] = boundedOperation(value)
    } else if (
      ["db.response.returned_rows", "db.redis.database_index"].includes(key) &&
      Number.isSafeInteger(value) &&
      value >= 0
    ) {
      result[key] = value
    }
  }
  return result
}

const boundedLinks = (links, kind) =>
  links?.map((link) => ({
    context: link.context,
    attributes: boundedAttributes(link.attributes, kind),
  }))

const boundedSpanName = (name, kind) => {
  if (kind === "pg" && ["pg.connect", "pg-pool.connect"].includes(name))
    return name
  return `${kind}.operation`
}

const boundedSpan = (span, kind) => {
  const wrapped = {
    spanContext: () => span.spanContext(),
    isRecording: () => span.isRecording(),
    end: (endTime) => span.end(endTime),
    setAttribute: (key, value) => {
      span.setAttributes(boundedAttributes({ [key]: value }, kind))
      return wrapped
    },
    setAttributes: (attributes) => {
      span.setAttributes(boundedAttributes(attributes, kind))
      return wrapped
    },
    setStatus: (status) => {
      span.setStatus({
        code: [0, 1, 2].includes(status.code) ? status.code : 0,
      })
      return wrapped
    },
    updateName: (name) => {
      span.updateName(boundedSpanName(name, kind))
      return wrapped
    },
    addLink: (link) => {
      span.addLink(boundedLinks([link], kind)[0])
      return wrapped
    },
    addLinks: (links) => {
      span.addLinks(boundedLinks(links, kind))
      return wrapped
    },
    // Error status is retained; arbitrary event names, messages and stacks are not.
    addEvent: () => wrapped,
    recordException: () => undefined,
  }
  return wrapped
}

const boundedTracer = (tracer, kind) => {
  const startSpan = (name, options, parentContext) =>
    boundedSpan(
      tracer.startSpan(
        boundedSpanName(name, kind),
        {
          ...options,
          attributes: boundedAttributes(options?.attributes, kind),
          links: boundedLinks(options?.links, kind),
        },
        parentContext
      ),
      kind
    )
  return {
    startSpan,
    startActiveSpan: (name, ...args) => {
      const callback = args.at(-1)
      const options = args.length > 1 ? args[0] : undefined
      const parentContext =
        (args.length > 2 ? args[1] : undefined) ?? context.active()
      const span = startSpan(name, options, parentContext)
      return context.with(
        trace.setSpan(parentContext, span),
        callback,
        undefined,
        span
      )
    },
  }
}

const boundedPgMetricAttributes = (attributes, poolNames) => {
  const result = boundedAttributes(attributes, "pg")
  const state = attributes?.["db.client.connection.state"]
  if (["idle", "used"].includes(state))
    result["db.client.connection.state"] = state
  if (attributes?.["error.type"]) result["error.type"] = "error"
  const poolName = attributes?.["db.client.connection.pool.name"]
  if (typeof poolName === "string" && poolName) {
    // Opaque process-local groups preserve series without publishing or hashing
    // connection details. The capped overflow bucket sums UpDownCounter deltas.
    if (
      !poolNames.has(poolName) &&
      poolNames.size < 32 &&
      poolName.length <= 1024
    ) {
      poolNames.set(poolName, `pool_${poolNames.size + 1}`)
    }
    result["db.client.connection.pool.name"] =
      poolNames.get(poolName) ?? "other"
  }
  return result
}

const boundedPgMeter = (meter) => {
  const poolNames = new Map()
  const filter = (attributes) =>
    boundedPgMetricAttributes(attributes, poolNames)
  const instruments = new WeakMap()
  const callbacks = new WeakMap()
  const batchCallbacks = new WeakMap()
  const originalInstrument = (instrument) =>
    instruments.get(instrument) ?? instrument
  const result = {}
  for (const [factory, record] of [
    ["createCounter", "add"],
    ["createUpDownCounter", "add"],
    ["createHistogram", "record"],
    ["createGauge", "record"],
  ]) {
    result[factory] = (...args) => {
      const instrument = meter[factory](...args)
      return {
        [record]: (value, attributes, activeContext) =>
          instrument[record](value, filter(attributes), activeContext),
      }
    }
  }
  for (const factory of [
    "createObservableCounter",
    "createObservableUpDownCounter",
    "createObservableGauge",
  ]) {
    result[factory] = (...args) => {
      const instrument = meter[factory](...args)
      const wrapped = {
        addCallback: (callback) => {
          if (!callbacks.has(callback))
            callbacks.set(callback, (observation) =>
              callback({
                observe: (value, attributes) =>
                  observation.observe(value, filter(attributes)),
              })
            )
          instrument.addCallback(callbacks.get(callback))
        },
        removeCallback: (callback) =>
          instrument.removeCallback(callbacks.get(callback) ?? callback),
      }
      instruments.set(wrapped, instrument)
      return wrapped
    }
  }
  result.addBatchObservableCallback = (callback, observables) => {
    if (!batchCallbacks.has(callback))
      batchCallbacks.set(callback, (observation) =>
        callback({
          observe: (instrument, value, attributes) =>
            observation.observe(
              originalInstrument(instrument),
              value,
              filter(attributes)
            ),
        })
      )
    meter.addBatchObservableCallback(
      batchCallbacks.get(callback),
      observables.map(originalInstrument)
    )
  }
  result.removeBatchObservableCallback = (callback, observables) =>
    meter.removeBatchObservableCallback(
      batchCallbacks.get(callback) ?? callback,
      observables.map(originalInstrument)
    )
  return result
}

const boundInstrumentation = (instrumentation, kind) => {
  const setTracerProvider =
    instrumentation.setTracerProvider.bind(instrumentation)
  instrumentation.setTracerProvider = (provider) =>
    setTracerProvider({
      getTracer: (...args) => boundedTracer(provider.getTracer(...args), kind),
    })
  instrumentation.setTracerProvider(trace.getTracerProvider())
  // Pg emits pool identifiers and query/error labels directly to its meter.
  // Runtime metrics use native bounded labels and must keep their own lifecycle.
  if (kind === "pg") {
    const setMeterProvider =
      instrumentation.setMeterProvider.bind(instrumentation)
    instrumentation.setMeterProvider = (provider) =>
      setMeterProvider({
        getMeter: (...args) => boundedPgMeter(provider.getMeter(...args)),
      })
    instrumentation.setMeterProvider(metrics.getMeterProvider())
  }
  return instrumentation
}

const sanitizeRedisStatement = (commandName) => {
  const normalized = String(commandName).trim().toLowerCase()
  return REDIS_COMMAND_PATTERN.test(normalized) ? normalized : "unknown"
}

const configureExporterDefaults = (environment = process.env) => {
  const endpoint = environment.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()
  if (!endpoint && !environment.OTEL_TRACES_EXPORTER?.trim()) {
    environment.OTEL_TRACES_EXPORTER = "none"
  }
  if (!endpoint && !environment.OTEL_METRICS_EXPORTER?.trim()) {
    environment.OTEL_METRICS_EXPORTER = "none"
  }
  if (!environment.OTEL_LOGS_EXPORTER?.trim()) {
    environment.OTEL_LOGS_EXPORTER = "none"
  }
}

const createInstrumentations = () => [
  boundInstrumentation(
    new IORedisInstrumentation({
      dbStatementSerializer: sanitizeRedisStatement,
    }),
    "redis"
  ),
  boundInstrumentation(new KnexInstrumentation({ maxQueryLength: 0 }), "knex"),
  boundInstrumentation(
    new PgInstrumentation({
      addSqlCommenterCommentToQueries: false,
      enableTraceContextPropagation: false,
      enhancedDatabaseReporting: false,
    }),
    "pg"
  ),
  boundInstrumentation(
    new RedisInstrumentation({
      dbStatementSerializer: sanitizeRedisStatement,
    }),
    "redis"
  ),
  boundInstrumentation(
    new RuntimeNodeInstrumentation({
      captureUncaughtException: false,
    }),
    "runtime"
  ),
]

const startObservability = (environment = process.env) => {
  if (["1", "true"].includes(environment.OTEL_SDK_DISABLED?.toLowerCase())) {
    return null
  }

  configureExporterDefaults(environment)
  const sdk = new NodeSDK({
    instrumentations: createInstrumentations(),
    serviceName: environment.OTEL_SERVICE_NAME?.trim() || "backend",
  })
  sdk.start()
  return sdk
}

const sdk = startObservability()
if (sdk) {
  let shutdownStarted = false
  const shutdown = () => {
    if (shutdownStarted) {
      return
    }
    shutdownStarted = true
    void sdk.shutdown().catch(() => undefined)
  }
  process.once("beforeExit", shutdown)
}

module.exports = {
  ALLOWED_INSTRUMENTATIONS,
  configureExporterDefaults,
  createInstrumentations,
  sanitizeRedisStatement,
  startObservability,
}
