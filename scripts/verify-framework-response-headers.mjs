import assert from "node:assert/strict"
import { readFile, realpath } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"

process.env.NODE_ENV = "test"

const rootDirectory = process.cwd()
const backendRequire = createRequire(
  path.join(rootDirectory, "backend/package.json")
)
const { configManager } = backendRequire("@medusajs/framework/config")
const { createSafeHttpCompletion, expressLoader } = backendRequire(
  "@medusajs/framework/http"
)
const medusaRoot = await realpath(
  path.join(rootDirectory, "backend/node_modules/@medusajs/medusa")
)
const medusaLoaderPath = path.join(medusaRoot, "dist/loaders/index.js")
const { resolveRequestCorrelation } = backendRequire(medusaLoaderPath)
const responseHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'self'",
}
const logger = {
  http: () => {},
  log: () => {},
  shouldLog: () => false,
}

configManager.loadConfig({
  baseDir: rootDirectory,
  projectConfig: {
    logger,
    projectConfig: {
      http: {
        adminCors: "",
        authCors: "",
        cookieSecret: "test",
        jwtSecret: "test",
        responseHeaders,
        storeCors: "",
      },
    },
  },
})

const disabledSettings = []
const registeredMiddleware = []
const app = {
  disable: (name) => {
    disabledSettings.push(name)
    return app
  },
  set: () => app,
  use: (...middleware) => {
    registeredMiddleware.push(middleware)
    return app
  },
}

const { shutdown } = await expressLoader({
  app,
  container: { resolve: () => logger },
})
const emittedHeaders = new Map()
let advanced = false

registeredMiddleware[0]?.[0]?.(
  {},
  {
    setHeader: (name, value) => {
      emittedHeaders.set(name, value)
    },
  },
  () => {
    advanced = true
  }
)

assert.equal(advanced, true)
assert.deepEqual(Object.fromEntries(emittedHeaders), responseHeaders)
assert.deepEqual(disabledSettings, ["x-powered-by"])

const traceId = "0123456789abcdef0123456789abcdef"
const parentId = "0123456789abcdef"
const correlation = resolveRequestCorrelation({
  traceparent: `00-${traceId}-${parentId}-00`,
  "x-request-id": "request_01:test",
})
assert.equal(correlation.requestId, "request_01:test")
assert.equal(correlation.traceId, traceId)
assert.equal(correlation.traceFlags, "00")
assert.match(correlation.spanId, /^[0-9a-f]{16}$/u)
assert.notEqual(correlation.spanId, parentId)

const rejectedCorrelation = resolveRequestCorrelation({
  traceparent: [`00-${traceId}-${parentId}-01`],
  "x-request-id": ["attacker", "request_02"],
})
assert.match(
  rejectedCorrelation.requestId,
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
)
assert.notEqual(rejectedCorrelation.traceId, traceId)

const completion = createSafeHttpCompletion(
  {
    headers: { traceparent: correlation.traceparent },
    ip: "203.0.113.10",
    method: "POST",
    requestId: correlation.requestId,
    url: "/admin/users?email=private@example.com",
  },
  {
    locals: { problemCode: "provider_unavailable" },
    statusCode: 503,
  },
  12.3456
)
assert.deepEqual(
  {
    duration_ms: completion.duration_ms,
    event: completion.event,
    method: completion.method,
    problem_code: completion.problem_code,
    request_id: completion.request_id,
    service: completion.service,
    status: completion.status,
    trace_id: completion.trace_id,
  },
  {
    duration_ms: 12.346,
    event: "http.request.completed",
    method: "POST",
    problem_code: "provider_unavailable",
    request_id: "request_01:test",
    service: "backend",
    status: 503,
    trace_id: traceId,
  }
)
assert.match(completion.commit_sha, /^(?:[0-9a-f]{40}|unknown)$/u)
assert.match(completion.environment, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u)
for (const forbiddenField of [
  "client_ip",
  "headers",
  "path",
  "query",
  "referrer",
  "request_size",
  "response_size",
  "url",
  "user_agent",
]) {
  assert.equal(forbiddenField in completion, false)
}

const medusaLoaderSource = await readFile(medusaLoaderPath, "utf8")
assert.match(
  medusaLoaderSource,
  /res\.setHeader\("X-Request-Id", correlation\.requestId\)/u
)
assert.match(
  medusaLoaderSource,
  /res\.setHeader\("traceparent", correlation\.traceparent\)/u
)

await shutdown()

console.log(
  "Medusa framework headers and redacted request observability verified before framework routers."
)
