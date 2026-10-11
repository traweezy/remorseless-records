import assert from "node:assert/strict"
import { createHash, timingSafeEqual } from "node:crypto"
import { lstat, realpath } from "node:fs/promises"
import { createServer, request as httpRequest } from "node:http"
import { extname, resolve, sep } from "node:path"
import { readPinnedNativeAsset } from "./pinned-native-asset.mjs"

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex")
const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
const copy = (value) => JSON.parse(JSON.stringify(value))
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (record(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`
  return JSON.stringify(value)
}
const frozen = (value) => {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) frozen(child)
    Object.freeze(value)
  }
  return value
}
const bodyLimit = 2 * 1_024 * 1_024
const responseLimit = 4 * 1_024 * 1_024
const actorId = (id) =>
  typeof id === "string" && /^user_[A-Za-z0-9]{1,250}$/u.test(id)
const newsId = (id) =>
  typeof id === "string" && /^news_[A-Za-z0-9_-]{1,248}$/u.test(id)
const uuid = (value) =>
  typeof value === "string" &&
  /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/iu.test(
    value
  )
const bodyFields = [
  "content",
  "coverAltText",
  "coverUrl",
  "excerpt",
  "publishedAt",
  "status",
  "tags",
  "title",
]
const commandFields = [
  ...bodyFields,
  "expectedActorId",
  "expectedVersion",
  "idempotencyKey",
].sort()
const nativeShell = new Set([
  "/admin/users/me",
  "/admin/rbac/me/permissions",
  "/admin/feature-flags",
  "/admin/notifications/feed",
  "/admin/notifications",
  "/cloud/auth",
  "/admin/stores",
])
const nativeLayoutReads = new Set([
  "/admin/layouts/sidebar/configuration",
  "/admin/layouts/topbar/configuration",
  "/admin/layouts/configurations",
])
const layoutQueryMatches = (pathname, parameters) => {
  if (pathname !== "/admin/layouts/configurations")
    return [...parameters].length === 0
  return (
    [...parameters].length === 2 &&
    parameters.getAll("limit").length === 1 &&
    parameters.get("limit") === "1" &&
    parameters.getAll("fields").length === 1 &&
    parameters.get("fields") === "id"
  )
}
const layoutQueryEvidence = (pathname, parameters) => {
  const counts = new Map()
  for (const key of parameters.keys())
    counts.set(key, (counts.get(key) ?? 0) + 1)
  return {
    recognizedKeys: ["fields", "limit"]
      .filter((key) => counts.has(key))
      .map((key) => ({ key, count: counts.get(key) })),
    unknownKeyCount: [...counts]
      .filter(([key]) => !["fields", "limit"].includes(key))
      .reduce((sum, [, count]) => sum + count, 0),
    duplicateKeyCount: [...counts.values()].reduce(
      (sum, count) => sum + count - 1,
      0
    ),
    queryContractMatched: layoutQueryMatches(pathname, parameters),
  }
}
const appRoutes = new Set([
  "/app",
  "/app/",
  "/app/login",
  "/app/news",
  "/app/content",
  "/app/content/news",
])
const mediaTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
}
const nativeSecurityHeaderNames = new Set([
  "content-security-policy",
  "cross-origin-opener-policy",
  "permissions-policy",
  "referrer-policy",
  "x-content-type-options",
  "x-frame-options",
])
const pinNativeSecurityHeaders = (headers) => {
  assert.ok(record(headers), "Native News security headers must be an object")
  assert.ok(
    Object.keys(headers).every((name) => nativeSecurityHeaderNames.has(name)),
    "Only native security headers may be copied to compiled News responses"
  )
  assert.ok(
    Object.values(headers).every(
      (value) => typeof value === "string" && !/[\r\n]/u.test(value)
    ),
    "Native News security headers must contain safe string values"
  )
  assert.ok(
    Object.hasOwn(headers, "content-security-policy") &&
      typeof headers["content-security-policy"] === "string" &&
      headers["content-security-policy"].trim().length > 0,
    "Actual native CSP is required for compiled News acceptance"
  )
  return Object.freeze({ ...headers })
}
export const readNativeNewsSecurityHeaders = (nativeHeaders) => {
  assert.ok(
    record(nativeHeaders),
    "Actual native response headers are required"
  )
  const selected = {}
  for (const name of nativeSecurityHeaderNames)
    if (Object.hasOwn(nativeHeaders, name)) selected[name] = nativeHeaders[name]
  return pinNativeSecurityHeaders(selected)
}

export const validateNewsLoopbackOrigin = (raw) => {
  const url = new URL(raw)
  assert.equal(url.protocol, "http:", "News transport requires local HTTP")
  assert.equal(
    url.hostname,
    "127.0.0.1",
    "News transport requires literal loopback"
  )
  assert.ok(
    Number(url.port) >= 1_024 && Number(url.port) <= 65_535,
    "News transport requires an owned port"
  )
  assert.equal(
    url.origin,
    raw,
    "News origin cannot contain path/query/credentials"
  )
  return url
}
const validBody = (body) => {
  if (
    !record(body) ||
    Object.keys(body).sort().join(",") !== [...bodyFields].sort().join(",")
  )
    return false
  if (
    typeof body.title !== "string" ||
    !body.title.trim() ||
    body.title.length > 300 ||
    typeof body.content !== "string" ||
    !body.content.trim() ||
    body.content.length > 200_000
  )
    return false
  for (const [key, max] of [
    ["excerpt", 1_000],
    ["coverAltText", 500],
    ["coverUrl", 2_000],
  ])
    if (
      body[key] !== null &&
      (typeof body[key] !== "string" || body[key].length > max)
    )
      return false
  if (body.coverUrl !== null) {
    try {
      if (!["http:", "https:"].includes(new URL(body.coverUrl).protocol))
        return false
    } catch {
      return false
    }
  }
  return (
    ["draft", "scheduled", "published"].includes(body.status) &&
    (body.publishedAt === null ||
      (typeof body.publishedAt === "string" &&
        /^\d{4}-\d{2}-\d{2}T/u.test(body.publishedAt) &&
        Number.isFinite(Date.parse(body.publishedAt)))) &&
    Array.isArray(body.tags) &&
    body.tags.length <= 50 &&
    body.tags.every(
      (tag) => typeof tag === "string" && tag.length > 0 && tag.length <= 100
    )
  )
}
const validNewsQuery = (params) => {
  const seen = new Set()
  for (const [key, value] of params) {
    if (seen.has(key)) return false
    seen.add(key)
    if (key === "q") {
      if (value.length > 200) return false
    } else if (key === "limit") {
      if (!/^\d{1,3}$/u.test(value) || Number(value) < 1 || Number(value) > 100)
        return false
    } else if (key === "offset") {
      if (!/^\d{1,7}$/u.test(value)) return false
    } else if (
      !{
        archived: ["active", "archived", "all"],
        direction: ["asc", "desc"],
        order: ["created_at", "published_at", "status", "title", "updated_at"],
        status: ["draft", "scheduled", "published", "archived"],
      }[key]?.includes(value)
    )
      return false
  }
  return true
}
const collect = async (stream, limit) => {
  const chunks = []
  let length = 0
  for await (const chunk of stream) {
    length += chunk.length
    if (length > limit) throw new Error("News transport byte budget exceeded")
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
const deadline = async (promise, timeoutMs, onTimeout) => {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          onTimeout()
          reject(new Error("News transport deadline exceeded"))
        }, timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export const startNativeNewsLoopbackProxy = async ({
  upstreamOrigin,
  staticRoot,
  staticHashes,
  actors,
  ownedNewsIds,
  staticResponseHeaders,
  timeoutMs = 15_000,
}) => {
  const upstream = validateNewsLoopbackOrigin(upstreamOrigin)
  const securityHeaders = pinNativeSecurityHeaders(staticResponseHeaders)
  assert.ok(
    Number.isSafeInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 30_000
  )
  assert.ok(
    Array.isArray(ownedNewsIds) &&
      ownedNewsIds.length &&
      ownedNewsIds.every(newsId)
  )
  assert.equal(new Set(ownedNewsIds).size, ownedNewsIds.length)
  assert.ok(
    Array.isArray(actors) &&
      actors.length &&
      actors.every(
        (actor) =>
          record(actor) &&
          actorId(actor.id) &&
          typeof actor.email === "string" &&
          /^[^\s@]+@example\.invalid$/u.test(actor.email) &&
          typeof actor.password === "string" &&
          actor.password.length >= 20
      )
  )
  assert.equal(new Set(actors.map((actor) => actor.id)).size, actors.length)
  assert.equal(new Set(actors.map((actor) => actor.email)).size, actors.length)
  assert.ok(
    record(staticHashes) && /^[a-f\d]{64}$/u.test(staticHashes["index.html"])
  )
  const pinned = Object.freeze({ ...staticHashes })
  for (const [name, digest] of Object.entries(pinned)) {
    assert.ok(/^[a-f\d]{64}$/u.test(digest))
    assert.ok(/^[A-Za-z0-9_./-]+$/u.test(name))
    assert.ok(
      !name
        .split("/")
        .some(
          (part) => !part || part === "." || part === ".." || part === "Default"
        )
    )
  }
  const root = await realpath(staticRoot)
  assert.ok(
    !root.split(sep).includes("Default") && (await lstat(root)).isDirectory()
  )
  const owned = new Set(ownedNewsIds)
  const knownActors = frozen(copy(actors))
  const tokens = new Map()
  const receipts = []
  const unexpectedRequests = []
  const sockets = new Set()
  const socketClosures = []
  const upstreamSockets = new Set()
  const upstreamSocketClosures = []
  const upstreamRequests = new Set()
  const active = new Set()
  let origin
  let command = null
  let closed = false
  let closePromise
  const snapshotCommand = () =>
    command
      ? frozen(
          copy({
            entryId: command.entryId,
            expectedActorId: command.expectedActorId,
            expectedVersion: command.expectedVersion,
            dropSuccesses: command.dropSuccesses,
            body: command.body,
            rawBody: command.rawBody,
            idempotencyKey: command.idempotencyKey,
            requestBodySha256: command.requestBodySha256,
            putCount: command.putCount,
            dropped: command.dropped,
            statuses: command.statuses,
            attempts: command.attempts,
            inFlight: command.inFlight,
            proof: command.proof,
          })
        )
      : null
  const deny = (response, method, pathname, status, code, query = null) => {
    const path = /^\/(?:admin|auth|app|cloud)(?:\/[a-z_-]+)*$/u.test(pathname)
      ? pathname
      : "unrecognized-path"
    const entry = { method, path, status, code, ...(query ? { query } : {}) }
    unexpectedRequests.push(entry)
    receipts.push({ kind: "denied", ...entry })
    if (!response.destroyed && !response.headersSent) {
      response.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
        connection: "close",
      })
      response.end(JSON.stringify({ code }))
    }
  }
  const forward = ({ path, method, headers, body }) =>
    new Promise((done, reject) => {
      let settled = false
      let timer
      const finish = (error, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        upstreamRequests.delete(request)
        if (error) reject(error)
        else done(value)
      }
      const request = httpRequest(
        {
          // Path and query text cannot change the literal loopback destination.
          hostname: "127.0.0.1",
          port: upstream.port,
          path,
          method,
          headers: { ...headers, connection: "close" },
          agent: false,
        },
        async (response) => {
          try {
            finish(null, {
              status: response.statusCode,
              headers: response.headers,
              body: await collect(response, responseLimit),
            })
          } catch (error) {
            request.destroy()
            response.destroy()
            finish(error)
          }
        }
      )
      upstreamRequests.add(request)
      request.on("socket", (socket) => {
        upstreamSockets.add(socket)
        upstreamSocketClosures.push(
          new Promise((done) =>
            socket.once("close", () => {
              upstreamSockets.delete(socket)
              done()
            })
          )
        )
        if (closed) socket.destroy()
      })
      timer = setTimeout(
        () =>
          request.destroy(new Error("News native response deadline exceeded")),
        timeoutMs
      )
      request.on("error", (error) => finish(error))
      if (body.length) request.write(body)
      request.end()
    })
  const server = createServer((request, response) => {
    const operation = (async () => {
      let selected = null
      let pathname = "unrecognized-path"
      const method = request.method ?? ""
      try {
        const url = new URL(request.url, origin)
        pathname = url.pathname
        if (
          closed ||
          url.origin !== origin ||
          request.headers.host !== new URL(origin).host ||
          !["GET", "HEAD", "POST", "PUT", "DELETE"].includes(method) ||
          /%2f|%5c|\/\.|\\/iu.test(request.url)
        )
          return deny(response, method, pathname, 403, "news_target_denied")
        if (request.headers.origin && request.headers.origin !== origin)
          return deny(response, method, pathname, 403, "news_origin_denied")
        if (pathname === "/app" || pathname.startsWith("/app/")) {
          if (!["GET", "HEAD"].includes(method) || url.search)
            return deny(
              response,
              method,
              pathname,
              403,
              "news_static_scope_denied"
            )
          const relative = decodeURIComponent(pathname.slice(5))
          const name = Object.hasOwn(pinned, relative)
            ? relative
            : appRoutes.has(pathname)
              ? "index.html"
              : null
          if (!name || !Object.hasOwn(pinned, name))
            return deny(response, method, pathname, 404, "news_static_unknown")
          const filename = resolve(root, name)
          const bytes = await readPinnedNativeAsset(root, name)
          if (bytes === null)
            return deny(
              response,
              method,
              pathname,
              403,
              "news_static_path_denied"
            )
          if (hash(bytes) !== pinned[name])
            return deny(
              response,
              method,
              pathname,
              409,
              "news_static_hash_changed"
            )
          response.writeHead(200, {
            ...securityHeaders,
            "content-type":
              mediaTypes[extname(filename)] ?? "application/octet-stream",
            "cache-control": "no-store",
          })
          response.end(method === "HEAD" ? undefined : bytes)
          return
        }
        const bytes = await deadline(
          collect(request, bodyLimit),
          timeoutMs,
          () => request.destroy()
        )
        let parsed
        try {
          parsed = bytes.length ? JSON.parse(bytes.toString("utf8")) : undefined
        } catch {
          return deny(response, method, pathname, 403, "news_json_denied")
        }
        if (
          bytes.length &&
          !/^application\/json(?:\s*;|$)/iu.test(
            request.headers["content-type"] ?? ""
          )
        )
          return deny(
            response,
            method,
            pathname,
            403,
            "news_content_type_denied"
          )
        const authentication = [
          "/auth/user/emailpass",
          "/auth/session",
        ].includes(pathname)
        let loginActor = null
        if (authentication) {
          if (url.search)
            return deny(
              response,
              method,
              pathname,
              403,
              "news_auth_scope_denied"
            )
          if (pathname === "/auth/user/emailpass") {
            loginActor = knownActors.find((actor) => {
              if (
                method !== "POST" ||
                !record(parsed) ||
                Object.keys(parsed).sort().join(",") !== "email,password" ||
                parsed.email !== actor.email ||
                typeof parsed.password !== "string"
              )
                return false
              const actual = Buffer.from(parsed.password)
              const expected = Buffer.from(actor.password)
              return (
                actual.length === expected.length &&
                timingSafeEqual(actual, expected)
              )
            })
            if (!loginActor)
              return deny(
                response,
                method,
                pathname,
                403,
                "news_login_actor_denied"
              )
          } else if (
            bytes.length ||
            !["POST", "DELETE"].includes(method) ||
            (method === "POST" && !tokens.has(request.headers.authorization))
          )
            return deny(response, method, pathname, 403, "news_session_denied")
        } else if (["GET", "HEAD"].includes(method)) {
          if (bytes.length)
            return deny(
              response,
              method,
              pathname,
              403,
              "news_read_body_denied",
              nativeLayoutReads.has(pathname)
                ? layoutQueryEvidence(pathname, url.searchParams)
                : null
            )
          if (nativeLayoutReads.has(pathname)) {
            if (
              method !== "GET" ||
              !layoutQueryMatches(pathname, url.searchParams)
            )
              return deny(
                response,
                method,
                pathname,
                403,
                "news_layout_query_denied",
                layoutQueryEvidence(pathname, url.searchParams)
              )
          } else if (pathname === "/admin/news") {
            if (!validNewsQuery(url.searchParams))
              return deny(
                response,
                method,
                pathname,
                403,
                "news_list_query_denied"
              )
          } else if (
            !(
              nativeShell.has(pathname) ||
              (pathname.startsWith("/admin/news/") &&
                owned.has(pathname.slice(12)))
            )
          )
            return deny(
              response,
              method,
              pathname,
              403,
              "news_read_scope_denied"
            )
          else if (pathname.startsWith("/admin/news/") && url.search)
            return deny(
              response,
              method,
              pathname,
              403,
              "news_detail_query_denied"
            )
          else if (
            [...url.searchParams].some(
              ([key, value]) =>
                key.length > 80 ||
                value.length > 4_096 ||
                /token|password|secret|authorization/iu.test(key)
            )
          )
            return deny(
              response,
              method,
              pathname,
              403,
              "news_shell_query_denied"
            )
        } else {
          if (
            method !== "PUT" ||
            url.search ||
            !command ||
            pathname !== `/admin/news/${command.entryId}` ||
            command.inFlight ||
            command.proof ||
            command.putCount >= 3 ||
            !record(parsed) ||
            Object.keys(parsed).sort().join(",") !== commandFields.join(",") ||
            parsed.expectedActorId !== command.expectedActorId ||
            parsed.expectedVersion !== command.expectedVersion ||
            !uuid(parsed.idempotencyKey)
          )
            return deny(
              response,
              method,
              pathname,
              403,
              "news_command_scope_denied"
            )
          const {
            expectedActorId: _actor,
            expectedVersion: _version,
            idempotencyKey: _key,
            ...body
          } = parsed
          if (
            canonical(body) !== command.logicalBody ||
            (command.rawBody !== null &&
              command.rawBody !== bytes.toString("utf8"))
          )
            return deny(
              response,
              method,
              pathname,
              403,
              "news_command_body_denied"
            )
          selected = command
          if (selected.rawBody === null) {
            selected.rawBody = bytes.toString("utf8")
            selected.body = frozen(copy(parsed))
            selected.idempotencyKey = parsed.idempotencyKey
            selected.requestBodySha256 = hash(bytes)
          }
          selected.putCount += 1
          selected.inFlight += 1
        }
        const headers = {}
        for (const key of [
          "accept",
          "authorization",
          "content-type",
          "cookie",
          "origin",
        ])
          if (request.headers[key]) headers[key] = request.headers[key]
        if (bytes.length) headers["content-length"] = String(bytes.length)
        const native = await forward({
          path: `${pathname}${url.search}`,
          method,
          headers,
          body: bytes,
        })
        const receipt = {
          kind: authentication ? "authentication" : "native",
          method,
          path: pathname,
          status: native.status,
          ...(nativeLayoutReads.has(pathname)
            ? {
                query: layoutQueryEvidence(pathname, url.searchParams),
                requestBodyBytes: bytes.length,
              }
            : {}),
          ...(authentication
            ? { authPayload: "redacted" }
            : {
                requestBodySha256: hash(bytes),
                responseBodySha256: hash(native.body),
              }),
        }
        receipts.push(receipt)
        const attempt = selected
          ? {
              attempt: selected.putCount,
              status: native.status,
              requestBodySha256: hash(bytes),
              responseBodySha256: hash(native.body),
              dropped: false,
            }
          : null
        if (selected) {
          selected.statuses.push(native.status)
          selected.attempts.push(attempt)
        }
        if (
          !authentication &&
          native.status >= 200 &&
          native.status < 300 &&
          method !== "HEAD" &&
          pathname.startsWith("/admin/news")
        ) {
          const payload = JSON.parse(native.body.toString("utf8"))
          if (pathname === "/admin/news") {
            assert.ok(
              Array.isArray(payload.entries) &&
                payload.entries.every((entry) => owned.has(entry?.id))
            )
            assert.equal(
              new Set(payload.entries.map((entry) => entry.id)).size,
              payload.entries.length
            )
            assert.ok(
              Number.isSafeInteger(payload.count) &&
                payload.count >= payload.entries.length &&
                payload.count <= owned.size
            )
          } else {
            assert.equal(payload?.entry?.id, pathname.slice(12))
            if (selected) {
              assert.equal(payload.entry.version, selected.expectedVersion + 1)
              assert.equal(typeof payload.replayed, "boolean")
            }
          }
        }
        if (loginActor && native.status >= 200 && native.status < 300) {
          const token = JSON.parse(native.body.toString("utf8"))?.token
          assert.ok(
            typeof token === "string" && /^[\w.-]{20,8192}$/u.test(token)
          )
          tokens.set(`Bearer ${token}`, loginActor.id)
        }
        if (selected) {
          attempt.dropped =
            native.status >= 200 &&
            native.status < 300 &&
            selected.dropped < selected.dropSuccesses
          if (attempt.dropped) {
            selected.dropped += 1
            receipt.dropped = true
            response.destroy()
            return
          }
          if (!response.destroyed && !closed) {
            if (native.status >= 200 && native.status < 300)
              selected.proof = "accepted"
            else if (
              selected.putCount === 1 &&
              native.status >= 400 &&
              native.status < 500
            )
              selected.proof = "rejected"
          }
        }
        if (closed || response.destroyed) return
        const responseHeaders = { connection: "close" }
        for (const key of [
          "content-type",
          "set-cookie",
          "cache-control",
          ...nativeSecurityHeaderNames,
        ])
          if (native.headers[key]) responseHeaders[key] = native.headers[key]
        response.writeHead(native.status, responseHeaders)
        response.end(method === "HEAD" ? undefined : native.body)
      } catch {
        if (!closed)
          deny(response, method, pathname, 502, "news_transport_failed")
        if (!response.destroyed && response.headersSent) response.destroy()
      } finally {
        if (selected) selected.inFlight -= 1
      }
    })()
    active.add(operation)
    void operation.finally(() => active.delete(operation))
  })
  server.on("connection", (socket) => {
    sockets.add(socket)
    socketClosures.push(
      new Promise((done) =>
        socket.once("close", () => {
          sockets.delete(socket)
          done()
        })
      )
    )
  })
  server.requestTimeout = timeoutMs
  server.headersTimeout = timeoutMs
  await new Promise((done, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", done)
  })
  origin = `http://127.0.0.1:${server.address().port}`
  return {
    origin,
    receipts,
    unexpectedRequests,
    armNewsUpdate: ({
      entryId,
      expectedActorId,
      expectedVersion,
      bodyWithoutCommandFields,
      dropSuccesses = 0,
    }) => {
      assert.ok(!closed && !command, "A News command is already armed")
      assert.ok(
        owned.has(entryId) &&
          knownActors.some((actor) => actor.id === expectedActorId)
      )
      assert.ok(Number.isSafeInteger(expectedVersion) && expectedVersion >= 1)
      assert.ok(
        validBody(bodyWithoutCommandFields),
        "News intent must contain the exact eight logical fields"
      )
      assert.ok([0, 1, 2].includes(dropSuccesses))
      command = {
        entryId,
        expectedActorId,
        expectedVersion,
        dropSuccesses,
        logicalBody: canonical(copy(bodyWithoutCommandFields)),
        body: null,
        rawBody: null,
        idempotencyKey: null,
        requestBodySha256: null,
        putCount: 0,
        dropped: 0,
        statuses: [],
        attempts: [],
        inFlight: 0,
        proof: null,
      }
    },
    commandSnapshot: snapshotCommand,
    finishCommand: () => {
      assert.ok(
        command && command.proof && command.inFlight === 0,
        "An unresolved News command cannot be finished"
      )
      const result = snapshotCommand()
      command = null
      return result
    },
    snapshot: () => ({
      closed,
      openSockets: sockets.size,
      openUpstreamSockets: upstreamSockets.size,
      inFlight: active.size,
      upstreamRequests: upstreamRequests.size,
      unexpectedRequestCount: unexpectedRequests.length,
    }),
    close: () => {
      if (!closePromise)
        closePromise = (async () => {
          closed = true
          command = null
          tokens.clear()
          for (const request of upstreamRequests)
            request.destroy(new Error("News proxy closing"))
          for (const socket of upstreamSockets) socket.destroy()
          const closing = new Promise((done, reject) =>
            server.close((error) => (error ? reject(error) : done()))
          )
          server.closeAllConnections()
          for (const socket of sockets) socket.destroy()
          await deadline(
            Promise.all([
              closing,
              Promise.allSettled([...active]),
              Promise.all(socketClosures),
              Promise.all(upstreamSocketClosures),
            ]),
            timeoutMs + 2_000,
            () => {
              for (const request of upstreamRequests) request.destroy()
              for (const socket of sockets) socket.destroy()
              for (const socket of upstreamSockets) socket.destroy()
            }
          )
          assert.equal(sockets.size, 0, "News proxy sockets remain")
          assert.equal(active.size, 0, "News proxy operations remain")
          assert.equal(
            upstreamRequests.size,
            0,
            "News proxy upstream requests remain"
          )
          assert.equal(
            upstreamSockets.size,
            0,
            "News proxy upstream sockets remain"
          )
        })()
      return closePromise
    },
  }
}
