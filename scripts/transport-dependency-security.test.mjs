import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:http"
import { createRequire } from "node:module"
import { test } from "node:test"

const backendRequire = createRequire(
  new URL("../backend/package.json", import.meta.url)
)
const requireThrough = (consumerRequire, names) =>
  names.reduce(
    (currentRequire, name) => createRequire(currentRequire.resolve(name)),
    consumerRequire
  )
const telemetryRequire = requireThrough(backendRequire, [
  "@medusajs/framework",
  "@medusajs/telemetry",
])
const axios = telemetryRequire("axios")
const exporterRequire = requireThrough(backendRequire, [
  "@opentelemetry/sdk-node",
  "@opentelemetry/exporter-trace-otlp-grpc",
  "@opentelemetry/otlp-grpc-exporter-base",
])
const grpc = exporterRequire("@grpc/grpc-js")

test("Medusa telemetry HTTP and fetch adapters enforce a zero redirect limit", {
  timeout: 10_000,
}, async () => {
  let targetHits = 0
  const server = createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/target" })
      response.end()
    } else {
      targetHits += 1
      response.end("ordinary response")
    }
  })
  try {
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    const origin = `http://127.0.0.1:${server.address().port}`
    for (const adapter of ["http", "fetch"]) {
      await assert.rejects(
        axios.get(`${origin}/redirect`, {
          adapter,
          maxRedirects: 0,
          timeout: 2000,
          proxy: false,
        })
      )
      assert.equal(
        targetHits,
        0,
        `${adapter} must not contact the redirect target`
      )
    }
    assert.equal(
      (await axios.get(`${origin}/target`, { timeout: 2000, proxy: false }))
        .data,
      "ordinary response"
    )
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("Medusa telemetry ignores an inherited default HTTP method", {
  timeout: 10_000,
}, () => {
  // Simulate pollution only in a bounded child so unrelated tests and the
  // test runner cannot inherit the malicious option.
  execFileSync(
    process.execPath,
    [
      "--max-old-space-size=64",
      "--input-type=module",
      "-e",
      `
import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer } from "node:http"
import { createRequire } from "node:module"
const axios = createRequire(import.meta.url)(process.argv[1])
const methods = []
const server = createServer((request, response) => {
  methods.push(request.method)
  response.end("ok")
})
server.listen(0, "127.0.0.1")
await once(server, "listening")
const url = "http://127.0.0.1:" + server.address().port
try {
  Object.defineProperty(Object.prototype, "method", { value: "DELETE", configurable: true, writable: true })
  await axios.request({ url, proxy: false, timeout: 2000 })
  await axios.request({ url, method: "POST", proxy: false, timeout: 2000 })
} finally {
  delete Object.prototype.method
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}
assert.deepEqual(methods, ["GET", "POST"])
`,
      telemetryRequire.resolve("axios"),
    ],
    { encoding: "utf8", timeout: 5_000, maxBuffer: 16_384 }
  )
})

test("OTLP gRPC transport redacts thrown server details and preserves successful RPCs", {
  timeout: 10_000,
}, async () => {
  const serialize = (value) => Buffer.from(value)
  const deserialize = (value) => value.toString()
  const definition = {
    check: {
      path: "/fixture.Security/Check",
      requestStream: false,
      responseStream: false,
      requestSerialize: serialize,
      requestDeserialize: deserialize,
      responseSerialize: serialize,
      responseDeserialize: deserialize,
    },
  }
  const server = new grpc.Server()
  server.addService(definition, {
    check: (call, callback) => {
      if (call.request === "fail") throw new Error("private fixture failure")
      callback(null, "ok")
    },
  })
  const port = await new Promise((resolve, reject) => {
    server.bindAsync(
      "127.0.0.1:0",
      grpc.ServerCredentials.createInsecure(),
      (error, value) => {
        if (error) reject(error)
        else resolve(value)
      }
    )
  })
  const Client = grpc.makeGenericClientConstructor(definition, "Fixture")
  const client = new Client(
    `127.0.0.1:${port}`,
    grpc.credentials.createInsecure()
  )
  const request = (value) =>
    new Promise((resolve, reject) => {
      client.check(
        value,
        { deadline: Date.now() + 2000 },
        (error, response) => {
          if (error) reject(error)
          else resolve(response)
        }
      )
    })
  try {
    assert.equal(await request("success"), "ok")
    await assert.rejects(request("fail"), {
      code: grpc.status.UNKNOWN,
      details: "Unknown error",
    })
  } finally {
    client.close()
    server.forceShutdown()
  }
})
