import assert from "node:assert/strict"
import { createHash, randomBytes } from "node:crypto"
import {
  mkdir,
  mkdtemp,
  readdir,
  readlink,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises"
import { createServer, request as httpRequest } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import {
  readNativeNewsSecurityHeaders,
  startNativeNewsLoopbackProxy,
  validateNewsLoopbackOrigin,
} from "./native-news-loopback-proxy.mjs"
import { readPinnedNativeAsset } from "./pinned-native-asset.mjs"

// Real loopback transport units. These do not start Medusa or establish native
// persistence, browser session/reload, screenshots or release acceptance.
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex")
const nonce = "00000000-0000-4000-8000-000000000001"
const input = () => ({
  content: "<p>Owned News</p>",
  coverAltText: null,
  coverUrl: null,
  excerpt: null,
  publishedAt: null,
  status: "published",
  tags: [],
  title: "Owned News",
})
const body = (changes = {}) => ({
  ...input(),
  expectedActorId: "user_owned",
  expectedVersion: 1,
  idempotencyKey: nonce,
  ...changes,
})
const nativeReply = (
  response,
  value = { entry: { id: "news_owned", version: 2 }, replayed: false },
  status = 200
) => {
  response.writeHead(status, { "content-type": "application/json" })
  response.end(JSON.stringify(value))
}
const setup = async (t, handler, timeoutMs = 300) => {
  const root = await mkdtemp(join(tmpdir(), "rr-news-loopback-unit-"))
  const index = Buffer.from("<html><body>News transport unit</body></html>")
  const asset = Buffer.from("export const fixture=true")
  await mkdir(join(root, "assets"))
  await writeFile(join(root, "index.html"), index)
  await writeFile(join(root, "assets", "owned.js"), asset)
  const staticHashes = {
    "index.html": digest(index),
    "assets/owned.js": digest(asset),
  }
  const actors = [
    {
      id: "user_owned",
      email: "news-unit@example.invalid",
      password: randomBytes(24).toString("base64url"),
    },
  ]
  const calls = []
  const native = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const bytes = Buffer.concat(chunks)
    calls.push({
      method: request.method,
      path: request.url,
      body: bytes.toString("utf8"),
    })
    if (handler) return handler(request, response, bytes, calls.length)
    nativeReply(response)
  })
  let proxy
  t.after(async () => {
    try {
      if (proxy) await proxy.close()
    } finally {
      try {
        native.closeAllConnections()
        await new Promise((done, reject) =>
          native.close((error) => (error ? reject(error) : done()))
        )
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  })
  await new Promise((done) => native.listen(0, "127.0.0.1", done))
  const options = {
    upstreamOrigin: `http://127.0.0.1:${native.address().port}`,
    staticRoot: root,
    staticHashes,
    actors,
    ownedNewsIds: ["news_owned"],
    staticResponseHeaders: {
      "content-security-policy": "default-src 'self'; script-src 'self'",
    },
    timeoutMs,
  }
  proxy = await startNativeNewsLoopbackProxy(options)
  const send = (path, method = "GET", data, headers = {}) =>
    fetch(`${proxy.origin}${path}`, {
      method,
      headers: {
        ...headers,
        ...(data !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(data === undefined
        ? {}
        : { body: typeof data === "string" ? data : JSON.stringify(data) }),
    })
  const arm = (dropSuccesses = 0, expected = input()) =>
    proxy.armNewsUpdate({
      entryId: "news_owned",
      expectedActorId: "user_owned",
      expectedVersion: 1,
      bodyWithoutCommandFields: expected,
      dropSuccesses,
    })
  return { root, index, asset, actors, calls, options, proxy, send, arm }
}

test("requires a canonical literal owned loopback origin", () => {
  assert.equal(
    validateNewsLoopbackOrigin("http://127.0.0.1:12345").port,
    "12345"
  )
  for (const origin of [
    "https://127.0.0.1:12345",
    "http://localhost:12345",
    "http://127.0.0.2:12345",
    "http://127.0.0.1:80",
    "http://127.0.0.1:12345/",
    "http://127.0.0.1:12345?token=private",
    "http://user:pass@127.0.0.1:12345",
  ])
    assert.throws(() => validateNewsLoopbackOrigin(origin))
})
test("requires actual CSP and selects only immutable native security headers", () => {
  const native = {
    "content-security-policy": "default-src 'self'; script-src 'self'",
    "cross-origin-opener-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=()",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "content-type": "application/json",
    "set-cookie": "unit-private-cookie",
  }
  const pinned = readNativeNewsSecurityHeaders(native)
  assert.equal(Object.isFrozen(pinned), true)
  assert.equal(Object.keys(pinned).length, 6)
  assert.equal(pinned["content-type"], undefined)
  assert.equal(pinned["set-cookie"], undefined)
  native["content-security-policy"] = "changed after selection"
  assert.equal(
    pinned["content-security-policy"],
    "default-src 'self'; script-src 'self'"
  )
  assert.throws(() => {
    pinned["x-frame-options"] = "SAMEORIGIN"
  })
  for (const invalid of [
    null,
    [],
    {},
    { "content-security-policy": " " },
    { "content-security-policy": ["default-src 'self'"] },
    { "content-security-policy": "default-src 'self'\r\nx-private: unsafe" },
    { "content-security-policy": "default-src 'self'", "x-frame-options": 1 },
  ])
    assert.throws(() => readNativeNewsSecurityHeaders(invalid))
})
test("pins native security headers on static routes and assets without native forwarding", async (t) => {
  const { options, calls } = await setup(t)
  const headers = {
    "content-security-policy": "default-src 'self'; script-src 'self'",
    "x-frame-options": "DENY",
  }
  const proxy = await startNativeNewsLoopbackProxy({
    ...options,
    staticResponseHeaders: headers,
  })
  try {
    headers["content-security-policy"] = "changed after startup"
    headers["set-cookie"] = "never copied"
    for (const [path, method] of [
      ["/app/content/news", "GET"],
      ["/app/assets/owned.js", "HEAD"],
    ]) {
      const response = await fetch(`${proxy.origin}${path}`, { method })
      assert.equal(response.status, 200)
      assert.equal(
        response.headers.get("content-security-policy"),
        "default-src 'self'; script-src 'self'"
      )
      assert.equal(response.headers.get("x-frame-options"), "DENY")
      assert.equal(response.headers.get("set-cookie"), null)
      await response.arrayBuffer()
    }
    assert.equal(calls.length, 0)
  } finally {
    await proxy.close()
  }
})
test("rejects missing unsafe or non-security static headers before native forwarding", async (t) => {
  const { options, calls } = await setup(t)
  for (const staticResponseHeaders of [
    undefined,
    {},
    Object.create({ "content-security-policy": "default-src 'self'" }),
    { "content-security-policy": " " },
    { "content-security-policy": "default-src 'self'\nunsafe" },
    {
      "content-security-policy": "default-src 'self'",
      "x-frame-options": ["DENY"],
    },
    {
      "content-security-policy": "default-src 'self'",
      "set-cookie": "not security",
    },
    {
      "content-security-policy": "default-src 'self'",
      location: "https://example.invalid",
    },
  ])
    await assert.rejects(
      startNativeNewsLoopbackProxy({ ...options, staticResponseHeaders })
    )
  assert.equal(calls.length, 0)
})
test("serves only pinned compiled index/routes/assets and rejects hash changes", async (t) => {
  const { send, root, index, asset, calls, options } = await setup(t)
  for (const path of ["/app", "/app/login", "/app/content/news", "/app/news"])
    assert.deepEqual(Buffer.from(await (await send(path)).arrayBuffer()), index)
  assert.equal((await send("/app/assets/owned.js", "HEAD")).status, 200)
  assert.deepEqual(
    Buffer.from(await (await send("/app/assets/owned.js")).arrayBuffer()),
    asset
  )
  assert.equal((await send("/app/settings")).status, 404)
  assert.equal((await send("/app/assets/missing.js")).status, 404)
  options.staticHashes["index.html"] = digest("changed manifest")
  assert.equal((await send("/app")).status, 200)
  await writeFile(join(root, "index.html"), "changed bytes")
  assert.equal((await send("/app")).status, 409)
  assert.equal(calls.length, 0)
})
test("rejects pinned asset symlinks before reading their contents", async (t) => {
  const { root, options } = await setup(t)
  await writeFile(join(root, "outside.txt"), "private")
  await symlink(join(root, "outside.txt"), join(root, "assets", "linked.js"))
  const proxy = await startNativeNewsLoopbackProxy({
    ...options,
    staticHashes: {
      ...options.staticHashes,
      "assets/linked.js": digest("private"),
    },
  })
  try {
    assert.equal(
      (await fetch(`${proxy.origin}/app/assets/linked.js`)).status,
      403
    )
  } finally {
    await proxy.close()
  }
})
test("bounds descriptor reads and rejects directory links without leaking handles", async (t) => {
  const { root, asset } = await setup(t)
  const outside = await mkdtemp(join(tmpdir(), "rr-news-owned-outside-"))
  t.after(() => rm(outside, { recursive: true, force: true }))
  await writeFile(join(outside, "owned.js"), asset)
  await symlink(outside, join(root, "linked-directory"))
  await mkdir(join(root, "directory.js"))
  await writeFile(join(root, "large.js"), "")
  await truncate(join(root, "large.js"), 32 * 1_024 * 1_024 + 1)
  await writeFile(join(root, "empty.js"), "")
  const ownedDescriptors = async () => {
    const entries = await readdir("/proc/self/fd")
    const targets = await Promise.all(
      entries.map((fd) => readlink(`/proc/self/fd/${fd}`).catch(() => ""))
    )
    return targets
      .filter(
        (target) =>
          target.startsWith(`${root}/`) || target.startsWith(`${outside}/`)
      )
      .sort()
  }
  const before = await ownedDescriptors()
  assert.deepEqual(await readPinnedNativeAsset(root, "assets/owned.js"), asset)
  assert.deepEqual(
    await readPinnedNativeAsset(root, "empty.js"),
    Buffer.alloc(0)
  )
  for (const name of [
    "linked-directory/owned.js",
    "directory.js",
    "large.js",
    "absent.js",
    "../outside.js",
  ])
    assert.equal(await readPinnedNativeAsset(root, name), null)
  assert.deepEqual(await ownedDescriptors(), before)
})
test("forwards native bytes, native errors and session cookies without recording secrets", async (t) => {
  const cookie = `connect.sid=${randomBytes(24).toString("hex")}`
  const bytes = Buffer.from('{"user":{"id":"user_owned","name":"Native æ"}}')
  const { send, proxy } = await setup(t, (request, response) => {
    assert.equal(request.headers.cookie, cookie)
    response.writeHead(401, {
      "content-type": "application/json",
      "set-cookie": `${cookie}; HttpOnly; Path=/`,
      "content-security-policy": "default-src 'self'; script-src 'self'",
      "x-frame-options": "DENY",
    })
    response.end(bytes)
  })
  const result = await send("/admin/users/me", "GET", undefined, { cookie })
  assert.equal(result.status, 401)
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), bytes)
  assert.equal(result.headers.get("set-cookie"), `${cookie}; HttpOnly; Path=/`)
  assert.equal(
    result.headers.get("content-security-policy"),
    "default-src 'self'; script-src 'self'"
  )
  assert.equal(result.headers.get("x-frame-options"), "DENY")
  assert.equal(proxy.receipts[0].responseBodySha256, digest(bytes))
  assert.ok(!JSON.stringify(proxy.receipts).includes(cookie))
})
test("forwards only the three source-derived layout GET contracts with native authorization errors intact", async (t) => {
  const { send, calls, proxy } = await setup(t, (_request, response) =>
    nativeReply(response, { message: "Native access denied" }, 403)
  )
  for (const path of [
    "/admin/layouts/sidebar/configuration",
    "/admin/layouts/topbar/configuration",
    "/admin/layouts/configurations?limit=1&fields=id",
    "/admin/layouts/configurations?fields=id&limit=1",
  ]) {
    const response = await send(path)
    assert.equal(response.status, 403)
    assert.deepEqual(await response.json(), { message: "Native access denied" })
  }
  assert.equal(calls.length, 4)
  assert.ok(calls.every((call) => call.method === "GET" && call.body === ""))
  assert.equal(proxy.unexpectedRequests.length, 0)
  assert.ok(proxy.receipts.every((row) => row.query.queryContractMatched))
  assert.ok(proxy.receipts.every((row) => row.requestBodyBytes === 0))
})
test("rejects unsupported layout methods and query contracts without widening native resource reads", async (t) => {
  const { send, calls, proxy } = await setup(t)
  for (const [path, method] of [
    ["/admin/layouts/sidebar/configuration", "HEAD"],
    ["/admin/layouts/topbar/configuration", "POST"],
    ["/admin/layouts/sidebar/configuration?limit=1", "GET"],
    ["/admin/layouts/configurations", "GET"],
    ["/admin/layouts/configurations?limit=2&fields=id", "GET"],
    ["/admin/layouts/configurations?limit=1&fields=*", "GET"],
    ["/admin/layouts/configurations?limit=1&limit=1&fields=id", "GET"],
    ["/admin/layouts/configurations?limit=1&fields=id&extra=value", "GET"],
    ["/admin/orders?limit=3", "GET"],
  ]) {
    const response = await send(path, method)
    assert.equal(response.status, 403)
    await response.arrayBuffer()
  }
  assert.equal(calls.length, 0)
  assert.equal(proxy.unexpectedRequests.length, 9)
})
test("rejects layout GET bodies and journals fixed query keys without leaking unknown names or values", async (t) => {
  const { proxy, calls, send } = await setup(t)
  const responseStatus = await new Promise((done, reject) => {
    const request = httpRequest(
      `${proxy.origin}/admin/layouts/configurations?limit=1&fields=id`,
      { method: "GET", headers: { "content-length": "4" } },
      (response) => {
        response.resume()
        response.once("end", () => done(response.statusCode))
      }
    )
    request.once("error", reject)
    request.end("body")
  })
  assert.equal(responseStatus, 403)
  const privateName = "unit-private-user@example.invalid"
  const privateValue = "unit-private-query-value"
  const response = await send(
    `/admin/layouts/configurations?limit=1&fields=id&${encodeURIComponent(privateName)}=${privateValue}`
  )
  assert.equal(response.status, 403)
  await response.arrayBuffer()
  assert.equal(calls.length, 0)
  const journal = JSON.stringify(proxy.receipts)
  assert.ok(!journal.includes(privateName) && !journal.includes(privateValue))
  assert.deepEqual(proxy.receipts[1].query.recognizedKeys, [
    { key: "fields", count: 1 },
    { key: "limit", count: 1 },
  ])
  assert.equal(proxy.receipts[1].query.unknownKeyCount, 1)
  assert.equal(proxy.receipts[1].query.queryContractMatched, false)
})
test("allows only known synthetic actor login and tokens returned by that native login for session creation", async (t) => {
  const token = randomBytes(36).toString("base64url")
  const { send, actors, calls, proxy } = await setup(t, (request, response) => {
    if (request.url === "/auth/user/emailpass")
      return nativeReply(response, { token })
    assert.equal(request.headers.authorization, `Bearer ${token}`)
    response.writeHead(200, {
      "content-type": "application/json",
      "set-cookie": "connect.sid=unit-cookie; HttpOnly; Path=/",
    })
    response.end("{}")
  })
  assert.equal(
    (
      await send("/auth/user/emailpass", "POST", {
        email: "foreign@example.invalid",
        password: actors[0].password,
      })
    ).status,
    403
  )
  assert.equal(
    (
      await send("/auth/session", "POST", undefined, {
        authorization: `Bearer ${randomBytes(24).toString("hex")}`,
      })
    ).status,
    403
  )
  assert.equal(calls.length, 0)
  assert.equal(
    (
      await send("/auth/user/emailpass", "POST", {
        email: actors[0].email,
        password: actors[0].password,
      })
    ).status,
    200
  )
  assert.equal(
    (
      await send("/auth/session", "POST", undefined, {
        authorization: `Bearer ${token}`,
      })
    ).status,
    200
  )
  const receipts = JSON.stringify(proxy.receipts)
  assert.ok(
    !receipts.includes(token) &&
      !receipts.includes(actors[0].password) &&
      !receipts.includes(actors[0].email) &&
      !receipts.includes("unit-cookie")
  )
  assert.equal(
    proxy.receipts.filter((item) => item.kind === "authentication").length,
    2
  )
})
test("restricts News list queries, exact owned detail and native shell reads", async (t) => {
  const { send, calls } = await setup(t, (request, response) =>
    nativeReply(
      response,
      request.url.startsWith("/admin/news?")
        ? { entries: [{ id: "news_owned" }], count: 1, limit: 25, offset: 0 }
        : { entry: { id: "news_owned" } }
    )
  )
  assert.equal(
    (
      await send(
        "/admin/news?limit=25&offset=0&archived=active&status=draft&order=updated_at&direction=desc&q=Owned"
      )
    ).status,
    200
  )
  assert.equal((await send("/admin/news/news_owned")).status, 200)
  for (const path of [
    "/admin/news/news_foreign",
    "/admin/news?id=news_foreign",
    "/admin/news?limit=101",
    "/admin/news?limit=25&limit=1",
    "/admin/news/news_owned/archive",
    "/admin/news/news_owned?fields=id",
    "/admin/orders",
    "/admin/users/me?token=private",
  ])
    assert.equal((await send(path)).status, 403)
  assert.equal(calls.length, 2)
})
test("denies a native list response that contains any foreign News row", async (t) => {
  const { send, proxy } = await setup(t, (_request, response) =>
    nativeReply(response, { entries: [{ id: "news_foreign" }], count: 1 })
  )
  assert.equal((await send("/admin/news")).status, 502)
  assert.equal(proxy.unexpectedRequests.length, 1)
})
test("forwards the installed native shell notification collection and other exact shell reads", async (t) => {
  const { send, calls } = await setup(t)
  for (const path of [
    "/admin/notifications?limit=1&offset=0&fields=created_at",
    "/admin/notifications/feed",
    "/admin/feature-flags",
    "/admin/rbac/me/permissions",
    "/admin/stores",
    "/cloud/auth",
  ])
    assert.equal((await send(path)).status, 200)
  assert.equal(calls.length, 6)
})
test("denies arbitrary writes, cross-origin requests and unsupported methods before upstream", async (t) => {
  const { send, calls, proxy } = await setup(t)
  for (const [method, path] of [
    ["POST", "/admin/news"],
    ["DELETE", "/admin/news/news_owned"],
    ["POST", "/admin/news/news_owned/archive"],
    ["POST", "/admin/news/news_owned/restore"],
    ["PUT", "/admin/news/news_foreign"],
    ["PUT", "/admin/news/news_owned"],
    ["OPTIONS", "/admin/news"],
  ])
    assert.equal(
      (await send(path, method, method === "OPTIONS" ? undefined : body()))
        .status,
      403
    )
  assert.equal(
    (
      await send("/admin/users/me", "GET", undefined, {
        origin: "https://example.invalid",
      })
    ).status,
    403
  )
  assert.equal(calls.length, 0)
  assert.equal(proxy.unexpectedRequests.length, 8)
})
test("rejects altered first command fields while preserving the pending arm", async (t) => {
  const { send, arm, proxy, calls } = await setup(t)
  arm()
  for (const changed of [
    body({ expectedActorId: "user_foreign" }),
    body({ expectedVersion: 2 }),
    body({ idempotencyKey: "not-a-uuid" }),
    body({ title: "Different" }),
    body({ grant: "all" }),
  ])
    assert.equal(
      (await send("/admin/news/news_owned", "PUT", changed)).status,
      403
    )
  assert.equal(calls.length, 0)
  assert.equal(proxy.commandSnapshot().putCount, 0)
  assert.throws(() => proxy.finishCommand())
  assert.equal(
    (await send("/admin/news/news_owned", "PUT", body())).status,
    200
  )
  const snapshot = proxy.commandSnapshot()
  assert.equal(snapshot.idempotencyKey, nonce)
  assert.equal(snapshot.requestBodySha256, digest(JSON.stringify(body())))
  assert.throws(() => {
    snapshot.body.title = "changed"
  })
  assert.equal(proxy.finishCommand().proof, "accepted")
  assert.equal(proxy.commandSnapshot(), null)
  assert.equal(
    (await send("/admin/news/news_owned", "PUT", body())).status,
    403
  )
})
test("pins the immutable logical arm even when its caller later mutates input", async (t) => {
  const { arm, send, proxy } = await setup(t)
  const expected = input()
  arm(0, expected)
  expected.title = "changed after arm"
  assert.equal(
    (await send("/admin/news/news_owned", "PUT", body())).status,
    200
  )
  assert.equal(proxy.commandSnapshot().body.title, "Owned News")
})
test("drains and drops only a real successful native response then permits only byte-identical replay", async (t) => {
  const { arm, send, proxy, calls } = await setup(t)
  arm(1)
  const bytes = JSON.stringify(body())
  await assert.rejects(send("/admin/news/news_owned", "PUT", bytes))
  const reordered = JSON.stringify(
    Object.fromEntries(Object.entries(body()).reverse())
  )
  assert.equal(
    (await send("/admin/news/news_owned", "PUT", reordered)).status,
    403
  )
  assert.equal(
    (
      await send(
        "/admin/news/news_owned",
        "PUT",
        body({ idempotencyKey: "00000000-0000-4000-8000-000000000002" })
      )
    ).status,
    403
  )
  assert.equal((await send("/admin/news/news_owned", "PUT", bytes)).status, 200)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].body, calls[1].body)
  const command = proxy.finishCommand()
  assert.equal(command.rawBody, bytes)
  assert.deepEqual(command.statuses, [200, 200])
  assert.equal(command.dropped, 1)
  assert.equal(command.proof, "accepted")
  assert.equal(
    command.attempts[0].responseBodySha256,
    command.attempts[1].responseBodySha256
  )
})
test("allows two lost successful replies and exactly one third identical send", async (t) => {
  const { arm, send, proxy, calls } = await setup(t)
  arm(2)
  for (let attempt = 0; attempt < 2; attempt++)
    await assert.rejects(send("/admin/news/news_owned", "PUT", body()))
  assert.equal(proxy.commandSnapshot().proof, null)
  assert.throws(() => proxy.finishCommand())
  assert.equal(
    (await send("/admin/news/news_owned", "PUT", body())).status,
    200
  )
  assert.equal(calls.length, 3)
  assert.equal(new Set(calls.map((call) => call.body)).size, 1)
  assert.equal(proxy.finishCommand().dropped, 2)
})
test("first definitive native rejection is never dropped and can finish the fixture arm", async (t) => {
  const { arm, send, proxy } = await setup(t, (_request, response) =>
    nativeReply(response, { message: "Native conflict" }, 409)
  )
  arm(2)
  const result = await send("/admin/news/news_owned", "PUT", body())
  assert.equal(result.status, 409)
  assert.deepEqual(await result.json(), { message: "Native conflict" })
  assert.equal(proxy.commandSnapshot().dropped, 0)
  assert.equal(proxy.finishCommand().proof, "rejected")
})
test("a rejection after a dropped success cannot erase the uncertain fixture command", async (t) => {
  const { arm, send, proxy } = await setup(
    t,
    (_request, response, _body, count) =>
      nativeReply(
        response,
        count === 1 ? undefined : { message: "Actor changed" },
        count === 1 ? 200 : 401
      )
  )
  arm(1)
  await assert.rejects(send("/admin/news/news_owned", "PUT", body()))
  assert.equal(
    (await send("/admin/news/news_owned", "PUT", body())).status,
    401
  )
  assert.equal(proxy.commandSnapshot().proof, null)
  assert.throws(() => proxy.finishCommand())
  assert.throws(() => arm())
})
test("caps uncertain native PUTs at three and records every unexpected denied request", async (t) => {
  const { arm, send, proxy, calls } = await setup(t, (_request, response) =>
    nativeReply(response, { message: "Unavailable" }, 503)
  )
  arm()
  for (let attempt = 0; attempt < 3; attempt++)
    assert.equal(
      (await send("/admin/news/news_owned", "PUT", body())).status,
      503
    )
  assert.equal(
    (await send("/admin/news/news_owned", "PUT", body())).status,
    403
  )
  assert.equal((await send("/admin/payments")).status, 403)
  assert.equal(calls.length, 3)
  assert.equal(proxy.snapshot().unexpectedRequestCount, 2)
  assert.equal(proxy.commandSnapshot().putCount, 3)
  assert.throws(() => proxy.finishCommand())
})
test("does not label an invalid native acknowledgement accepted or drop it", async (t) => {
  const { arm, send, proxy } = await setup(t, (_request, response) =>
    nativeReply(response, {
      entry: { id: "news_foreign", version: 2 },
      replayed: false,
    })
  )
  arm(1)
  assert.equal(
    (await send("/admin/news/news_owned", "PUT", body())).status,
    502
  )
  assert.equal(proxy.commandSnapshot().proof, null)
  assert.equal(proxy.commandSnapshot().dropped, 0)
  assert.deepEqual(proxy.commandSnapshot().statuses, [200])
  assert.equal(proxy.commandSnapshot().attempts.length, 1)
  assert.throws(() => proxy.finishCommand())
})
test("bounds upstream response bytes and closes response sockets", async (t) => {
  const { send } = await setup(
    t,
    (_request, response) => {
      response.writeHead(200)
      response.end(Buffer.alloc(4 * 1_024 * 1_024 + 1))
    },
    1_000
  )
  assert.equal((await send("/admin/users/me")).status, 502)
})
test("bounds an incomplete upstream response with an absolute deadline", async (t) => {
  const { send, proxy } = await setup(
    t,
    (_request, response) => {
      response.writeHead(200)
      response.write("{")
    },
    100
  )
  assert.equal((await send("/admin/users/me")).status, 502)
  assert.equal(proxy.snapshot().upstreamRequests, 0)
})
test("nested cleanup closes active upstream requests and all observed sockets without timers left behind", async (t) => {
  let started
  const entered = new Promise((done) => {
    started = done
  })
  const { send, proxy } = await setup(
    t,
    (_request, response) => {
      response.writeHead(200)
      response.write("{")
      started()
    },
    1_000
  )
  const pending = send("/admin/users/me")
  const rejected = assert.rejects(pending)
  await entered
  await proxy.close()
  await rejected
  await proxy.close()
  assert.deepEqual(proxy.snapshot(), {
    closed: true,
    openSockets: 0,
    openUpstreamSockets: 0,
    inFlight: 0,
    upstreamRequests: 0,
    unexpectedRequestCount: 0,
  })
})
test("denies alternate Host targets and malformed JSON before native forwarding", async (t) => {
  const { proxy, send, calls, arm } = await setup(t)
  const status = await new Promise((done, reject) => {
    const request = httpRequest(
      proxy.origin,
      { path: "/admin/users/me", headers: { host: "example.invalid" } },
      (response) => {
        response.resume()
        done(response.statusCode)
      }
    )
    request.on("error", reject)
    request.end()
  })
  assert.equal(status, 403)
  arm()
  assert.equal((await send("/admin/news/news_owned", "PUT", "{")).status, 403)
  assert.equal(calls.length, 0)
})
