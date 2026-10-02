import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:http"
import { createRequire } from "node:module"
import { test } from "node:test"
import { gzipSync } from "node:zlib"

const rootRequire = createRequire(new URL("../package.json", import.meta.url))
const backendRequire = createRequire(
  new URL("../backend/package.json", import.meta.url)
)
const storefrontRequire = createRequire(
  new URL("../storefront/package.json", import.meta.url)
)

// Resolve through real consumers so a hoisted or duplicate package cannot make
// the regression pass while the application or its tooling stays vulnerable.
const requireThrough = (consumerRequire, packages) =>
  packages.reduce(
    (currentRequire, name) => createRequire(currentRequire.resolve(name)),
    consumerRequire
  )
const ajvRequire = requireThrough(backendRequire, [
  "@medusajs/framework",
  "@mikro-orm/migrations",
  "umzug",
  "@rushstack/ts-command-line",
  "@rushstack/terminal",
  "@rushstack/node-core-library",
  "ajv",
])
const socksRequire = requireThrough(rootRequire, [
  "proxy-agent",
  "socks-proxy-agent",
  "socks",
])
const jsdomRequire = requireThrough(storefrontRequire, ["jsdom"])
const fastUri = ajvRequire("fast-uri")
const { Address4, Address6 } = socksRequire("ip-address")
const { Agent, BalancedPool, Pool, interceptors } = jsdomRequire("undici")

test("migration tooling rejects malformed URI authorities and preserves valid references", () => {
  for (const uri of [
    "http://[fe80",
    "http://user@[@127.0.0.1:8123/admin",
    "http://user@prefix]@127.0.0.1:8123/admin",
  ]) {
    assert.equal(fastUri.parse(uri).error, "URI host is malformed.")
    assert.equal(fastUri.equal(uri, uri), false)
    assert.throws(
      () => fastUri.resolve("https://example.test/", uri),
      /URI host is malformed/u
    )
  }
  assert.throws(
    () =>
      fastUri.serialize({
        scheme: "https",
        host: "example.test",
        port: "@127.0.0.1:8123",
      }),
    /URI port is malformed/u
  )
  assert.equal(fastUri.parse("https://[2001:db8::1]:443/path").error, undefined)
  assert.equal(
    fastUri.resolve("https://example.test/schemas/", "item.json"),
    "https://example.test/schemas/item.json"
  )
})

test("migration tooling canonicalizes decoded hostname case without folding other URL components", () => {
  assert.equal(fastUri.parse("//%41.com").host, "a.com")
  assert.equal(fastUri.normalize("//%41.com"), "//a.com")
  assert.equal(fastUri.equal("//%41.com", "//a.com"), true)
  assert.equal(fastUri.equal("//User@%41.com", "//user@a.com"), false)
  assert.equal(fastUri.equal("//%41.com/Path", "//a.com/path"), false)
  assert.equal(fastUri.normalize("//%2541.com"), "//%2541.com")

  const Ajv = ajvRequire("ajv")
  const ajv = new Ajv()
  ajv.addSchema({ $id: "https://example.test/item", type: "string" })
  const validate = ajv.compile({
    type: "object",
    properties: { item: { $ref: "https://example.test/item" } },
  })
  assert.equal(validate({ item: "record" }), true)
  assert.equal(validate({ item: 42 }), false)
})

test("browser proxy address parsing recognizes NAT64 local-use and keeps address families separate", () => {
  for (const address of [
    "64:ff9b:1:7f00:0:100::",
    "64:ff9b:1:a9fe:a9:fe00::",
    "64:ff9b:1::7f00:1",
  ]) {
    assert.equal(new Address6(address).isPrivate(), true)
  }
  assert.equal(new Address6("64:ff9b::7f00:1").isLoopback(), true)
  assert.equal(new Address6("fe81::1").isLinkLocal(), true)
  assert.equal(new Address6("2606:4700:4700::1111").isPrivate(), false)
  assert.equal(
    new Address6("a00::1").isHostInSubnet(new Address4("10.0.0.0/8")),
    false
  )
  assert.equal(
    new Address4("32.0.0.1").isHostInSubnet(new Address6("2000::/3")),
    false
  )
  assert.equal(new Address4("192.0.2.42").correctForm(), "192.0.2.42")
  assert.equal(new Address6("2001:db8::1").correctForm(), "2001:db8::1")
})

test("browser proxy rejects oversized malformed addresses within a bounded child", {
  timeout: 10_000,
}, () => {
  execFileSync(
    process.execPath,
    [
      "--max-old-space-size=64",
      "--input-type=module",
      "-e",
      `
import assert from "node:assert/strict"
import { createRequire } from "node:module"
const { Address4, Address6 } = createRequire(import.meta.url)(process.argv[1])
for (const Address of [Address4, Address6]) {
  assert.throws(() => new Address("!".repeat(65_536)), (error) => {
    assert.equal(error.name, "AddressError")
    assert.ok(error.message.length < 200, "reject before formatting the entire input")
    return true
  })
  assert.equal(Address.isValid("!".repeat(65_536)), false)
}
`,
      socksRequire.resolve("ip-address"),
    ],
    { encoding: "utf8", timeout: 5_000, maxBuffer: 16_384 }
  )
})

test("jsdom HTTP pooling retains custom TLS validation callbacks", async () => {
  const checkServerIdentity = () => new Error("reject fixture certificate")
  for (const key of ["connect", "tls"]) {
    const seen = []
    const balanced = new BalancedPool(["https://example.test"], {
      [key]: { checkServerIdentity },
      factory: (origin, options) => {
        seen.push(options[key]?.checkServerIdentity)
        return new Pool(origin, options)
      },
    })
    try {
      balanced.addUpstream("https://another.example.test")
      assert.deepEqual(seen, [checkServerIdentity, checkServerIdentity])
    } finally {
      await balanced.destroy()
    }
  }
})

test("jsdom decompression bounds decoded bytes while preserving valid compressed responses", {
  timeout: 10_000,
}, async () => {
  const ordinary = "bounded response"
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-encoding": "gzip" })
    response.end(
      gzipSync(request.url === "/oversized" ? "x".repeat(2048) : ordinary)
    )
  })
  const agent = new Agent().compose(interceptors.decompress({ maxSize: 1024 }))
  try {
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    const origin = `http://127.0.0.1:${server.address().port}`
    const response = await agent.request({ origin, path: "/", method: "GET" })
    assert.equal(await response.body.text(), ordinary)
    await assert.rejects(
      async () => {
        const oversized = await agent.request({
          origin,
          path: "/oversized",
          method: "GET",
        })
        await oversized.body.text()
      },
      { code: "UND_ERR_RES_EXCEEDED_MAX_SIZE" }
    )
  } finally {
    await agent.destroy()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("jsdom WebSocket rejects an unrequested subprotocol without terminating the process", {
  timeout: 10_000,
}, () => {
  execFileSync(
    process.execPath,
    [
      "--max-old-space-size=64",
      "--input-type=module",
      "-e",
      `
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import { createRequire } from "node:module"
const { WebSocket } = createRequire(import.meta.url)(process.argv[1])
const server = createServer()
server.on("upgrade", (request, socket) => {
  const accept = createHash("sha1")
    .update(request.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64")
  socket.end([
    "HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade",
    "Sec-WebSocket-Accept: " + accept, "Sec-WebSocket-Protocol: unexpected", "", ""
  ].join("\\r\\n"))
})
server.listen(0, "127.0.0.1")
await once(server, "listening")
try {
  const socket = new WebSocket("ws://127.0.0.1:" + server.address().port)
  let errors = 0
  socket.addEventListener("error", () => { errors += 1 })
  await new Promise((resolve) => socket.addEventListener("close", resolve, { once: true }))
  assert.equal(errors, 1)
  assert.equal(socket.readyState, WebSocket.CLOSED)
} finally {
  await new Promise((resolve) => server.close(resolve))
}
`,
      jsdomRequire.resolve("undici"),
    ],
    { encoding: "utf8", timeout: 5_000, maxBuffer: 16_384 }
  )
})
