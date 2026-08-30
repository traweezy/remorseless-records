import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
process.env.OTEL_SDK_DISABLED = "true";
const bootstrap = require("../backend/scripts/observability-register.cjs");
const backendPackage = JSON.parse(
  await readFile(new URL("../backend/package.json", import.meta.url), "utf8"),
);
const postBuild = await readFile(
  new URL("../backend/src/scripts/postBuild.js", import.meta.url),
  "utf8",
);

assert.equal(bootstrap.sanitizeRedisStatement("SET", ["private-key"]), "set");
assert.equal(
  bootstrap.sanitizeRedisStatement("invalid command", []),
  "unknown",
);
assert.deepEqual([...bootstrap.ALLOWED_INSTRUMENTATIONS].sort(), [
  "@opentelemetry/instrumentation-ioredis",
  "@opentelemetry/instrumentation-knex",
  "@opentelemetry/instrumentation-pg",
  "@opentelemetry/instrumentation-redis",
  "@opentelemetry/instrumentation-runtime-node",
]);
for (const forbidden of [
  "@opentelemetry/instrumentation-aws-sdk",
  "@opentelemetry/instrumentation-http",
  "@opentelemetry/instrumentation-undici",
]) {
  assert.equal(bootstrap.ALLOWED_INSTRUMENTATIONS.has(forbidden), false);
}

const environment = {};
bootstrap.configureExporterDefaults(environment);
assert.deepEqual(environment, {
  OTEL_LOGS_EXPORTER: "none",
  OTEL_METRICS_EXPORTER: "none",
  OTEL_TRACES_EXPORTER: "none",
});

const configuredEnvironment = {
  OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.internal",
};
bootstrap.configureExporterDefaults(configuredEnvironment);
assert.deepEqual(configuredEnvironment, {
  OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.internal",
  OTEL_LOGS_EXPORTER: "none",
});

assert.equal(
  backendPackage.scripts.start,
  "cd .medusa/server && node --require ./observability-register.cjs ./node_modules/@medusajs/cli/cli.js start --verbose",
);
assert.match(postBuild, /fs\.copyFileSync\(OBSERVABILITY_BOOTSTRAP_SOURCE/u);

console.log(
  "Backend observability bootstrap verified: preloaded before Medusa with bounded DB, Redis, and runtime instrumentation.",
);
