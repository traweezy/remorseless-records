"use strict";

const {
  IORedisInstrumentation,
} = require("@opentelemetry/instrumentation-ioredis");
const { KnexInstrumentation } = require("@opentelemetry/instrumentation-knex");
const { PgInstrumentation } = require("@opentelemetry/instrumentation-pg");
const {
  RedisInstrumentation,
} = require("@opentelemetry/instrumentation-redis");
const {
  RuntimeNodeInstrumentation,
} = require("@opentelemetry/instrumentation-runtime-node");
const { NodeSDK } = require("@opentelemetry/sdk-node");

const ALLOWED_INSTRUMENTATIONS = new Set([
  "@opentelemetry/instrumentation-ioredis",
  "@opentelemetry/instrumentation-knex",
  "@opentelemetry/instrumentation-pg",
  "@opentelemetry/instrumentation-redis",
  "@opentelemetry/instrumentation-runtime-node",
]);
const REDIS_COMMAND_PATTERN = /^[a-z][a-z0-9_]{0,31}$/u;

const sanitizeRedisStatement = (commandName) => {
  const normalized = String(commandName).trim().toLowerCase();
  return REDIS_COMMAND_PATTERN.test(normalized) ? normalized : "unknown";
};

const configureExporterDefaults = (environment = process.env) => {
  const endpoint = environment.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint && !environment.OTEL_TRACES_EXPORTER?.trim()) {
    environment.OTEL_TRACES_EXPORTER = "none";
  }
  if (!endpoint && !environment.OTEL_METRICS_EXPORTER?.trim()) {
    environment.OTEL_METRICS_EXPORTER = "none";
  }
  if (!environment.OTEL_LOGS_EXPORTER?.trim()) {
    environment.OTEL_LOGS_EXPORTER = "none";
  }
};

const createInstrumentations = () => [
  new IORedisInstrumentation({
    dbStatementSerializer: sanitizeRedisStatement,
  }),
  new KnexInstrumentation(),
  new PgInstrumentation({
    addSqlCommenterCommentToQueries: false,
    enableTraceContextPropagation: false,
    enhancedDatabaseReporting: false,
  }),
  new RedisInstrumentation({
    dbStatementSerializer: sanitizeRedisStatement,
  }),
  new RuntimeNodeInstrumentation(),
];

const startObservability = (environment = process.env) => {
  if (["1", "true"].includes(environment.OTEL_SDK_DISABLED?.toLowerCase())) {
    return null;
  }

  configureExporterDefaults(environment);
  const sdk = new NodeSDK({
    instrumentations: createInstrumentations(),
    serviceName: environment.OTEL_SERVICE_NAME?.trim() || "backend",
  });
  sdk.start();
  return sdk;
};

const sdk = startObservability();
if (sdk) {
  let shutdownStarted = false;
  const shutdown = () => {
    if (shutdownStarted) {
      return;
    }
    shutdownStarted = true;
    void sdk.shutdown().catch(() => undefined);
  };
  process.once("beforeExit", shutdown);
}

module.exports = {
  ALLOWED_INSTRUMENTATIONS,
  configureExporterDefaults,
  createInstrumentations,
  sanitizeRedisStatement,
  startObservability,
};
