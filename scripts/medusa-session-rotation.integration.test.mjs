import assert from "node:assert/strict"
import { randomBytes, randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import test from "node:test"

// Never load application .env files or accept a credential-bearing remote URL.
const rawRedisUrl = process.env.REDIS_URL
if (
  process.env.INTEGRATION_TESTS_ENABLED !== "1" ||
  typeof rawRedisUrl !== "string" ||
  !/^redis:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):[1-9][0-9]{0,4}(?:\/0?)?$/u.test(
    rawRedisUrl
  )
)
  throw new Error(
    "Session rotation requires the disposable local Redis fixture."
  )
const redisUrl = new URL(rawRedisUrl)
if (Number(redisUrl.port) > 65535)
  throw new Error("Session rotation requires a valid fixture port.")

const backendRequire = createRequire(
  new URL("../backend/package.json", import.meta.url)
)
const frameworkRequire = createRequire(
  backendRequire.resolve("@medusajs/framework")
)
const medusaRequire = createRequire(backendRequire.resolve("@medusajs/medusa"))
assert.equal(frameworkRequire("../package.json").version, "2.18.0")
assert.equal(medusaRequire("../package.json").version, "2.18.0")
const { authenticate } = frameworkRequire(
  "./http/middlewares/authenticate-middleware.js"
)
const { POST: createSession } = medusaRequire("./api/auth/session/route.js")
const { ContainerRegistrationKeys } = frameworkRequire("@medusajs/utils")
const express = frameworkRequire("express")
const session = frameworkRequire("express-session")
const RedisStore = frameworkRequire("connect-redis")(session)
const Redis = frameworkRequire("ioredis")
const jwt = frameworkRequire("jsonwebtoken")

const authContext = Object.freeze({
  actor_id: "user_disposable_rotation",
  actor_type: "user",
  auth_identity_id: "authid_disposable_rotation",
  app_metadata: {},
  user_metadata: {},
})

test("pinned Medusa JWT and stored-session rotation matrix", {
  timeout: 30_000,
}, async (t) => {
  const prefix = `rr:session-rotation:${randomUUID()}:`
  const sessionIds = new Set()
  const servers = []
  const redis = new Redis(redisUrl.toString(), {
    lazyConnect: true,
    connectTimeout: 2_000,
    commandTimeout: 2_000,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  })
  const redisErrors = []
  redis.on("error", () => redisErrors.push("redis_connection_error"))
  const oldJwt = randomBytes(48).toString("base64url")
  const newJwt = randomBytes(48).toString("base64url")
  const oldCookie = randomBytes(48).toString("base64url")
  const newCookie = randomBytes(48).toString("base64url")
  const sign = (secret) =>
    jwt.sign(authContext, secret, { algorithm: "HS256", expiresIn: "2m" })
  const oldToken = sign(oldJwt)
  const newToken = sign(newJwt)

  t.after(async () => {
    const cleanupErrors = []
    try {
      const closed = await Promise.allSettled(
        servers.map(
          (server) =>
            new Promise((resolve, reject) => {
              server.close((error) => (error ? reject(error) : resolve()))
              server.closeAllConnections()
            })
        )
      )
      if (closed.some((result) => result.status === "rejected"))
        cleanupErrors.push(new Error("Session fixture HTTP cleanup failed."))
      if (sessionIds.size > 0) {
        try {
          assert.equal(
            redis.status,
            "ready",
            "Session key cleanup requires Redis."
          )
          // Only exact IDs issued by this synthetic endpoint are removed, even
          // when closing a server failed. Never accept unverified key cleanup.
          const keys = [...sessionIds].map((id) => `${prefix}${id}`)
          await redis.del(...keys)
          assert.equal(await redis.exists(...keys), 0)
        } catch {
          cleanupErrors.push(new Error("Session fixture key cleanup failed."))
        }
      }
      if (redisErrors.length > 0)
        cleanupErrors.push(
          new Error("Session fixture Redis connection failed.")
        )
      if (cleanupErrors.length > 0)
        throw new AggregateError(
          cleanupErrors,
          "Session fixture cleanup failed."
        )
    } finally {
      redis.disconnect()
    }
  })
  await redis.connect()
  assert.match(await redis.info("server"), /^redis_version:8\.10\.1\r?$/mu)

  const start = async (jwtSecret, cookieSecret) => {
    const app = express()
    const http = {
      jwtSecret,
      cookieSecret,
      jwtVerifyOptions: { algorithms: ["HS256"] },
    }
    app.disable("x-powered-by")
    app.set("trust proxy", "loopback")
    app.use(
      session({
        name: "connect.sid",
        resave: true,
        rolling: false,
        saveUninitialized: false,
        proxy: true,
        secret: cookieSecret,
        cookie: {
          httpOnly: true,
          sameSite: "lax",
          secure: true,
          maxAge: 60_000,
        },
        store: new RedisStore({ client: redis, prefix }),
      })
    )
    app.use((req, _res, next) => {
      req.scope = {
        resolve: (key) => {
          assert.equal(key, ContainerRegistrationKeys.CONFIG_MODULE)
          return { projectConfig: { http } }
        },
      }
      next()
    })
    app.post("/session", authenticate("user", "bearer"), (req, res, next) => {
      sessionIds.add(req.sessionID)
      Promise.resolve(createSession(req, res)).catch(next)
    })
    app.get(
      "/protected",
      authenticate("user", ["session", "bearer"]),
      (req, res) => {
        res.json({ actor_id: req.auth_context.actor_id })
      }
    )
    app.use((_error, _req, res, _next) =>
      res.status(500).json({ error: "fixture_failed" })
    )
    const server = app.listen(0, "127.0.0.1")
    servers.push(server)
    server.requestTimeout = 5_000
    server.headersTimeout = 5_000
    await new Promise((resolve, reject) => {
      server.once("listening", resolve)
      server.once("error", reject)
    })
    const address = server.address()
    assert.ok(address && typeof address === "object")
    return `http://127.0.0.1:${address.port}`
  }
  const request = async (origin, { token, cookie, create = false } = {}) => {
    const response = await fetch(
      `${origin}/${create ? "session" : "protected"}`,
      {
        method: create ? "POST" : "GET",
        headers: {
          "x-forwarded-proto": "https",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(cookie ? { cookie } : {}),
        },
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      }
    )
    const chunks = []
    let length = 0
    for await (const chunk of response.body) {
      length += chunk.length
      assert.ok(length <= 4_096)
      chunks.push(chunk)
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    return {
      status: response.status,
      body,
      cookie: response.headers.get("set-cookie"),
    }
  }
  const accepted = async (origin, options) => {
    const result = await request(origin, options)
    assert.equal(result.status, 200)
    assert.equal(result.body.actor_id, authContext.actor_id)
  }
  const rejected = async (origin, options) => {
    const result = await request(origin, options)
    assert.equal(result.status, 401)
    assert.deepEqual(result.body, { message: "Unauthorized" })
  }
  const issueSession = async (origin, token) => {
    const result = await request(origin, { token, create: true })
    assert.equal(result.status, 200)
    assert.equal(result.body.user.actor_id, authContext.actor_id)
    assert.match(result.cookie, /^connect\.sid=s%3A/u)
    for (const attribute of ["HttpOnly", "Secure", "SameSite=Lax"])
      assert.ok(result.cookie.includes(attribute))
    return result.cookie.split(";", 1)[0]
  }

  const baseline = await start(oldJwt, oldCookie)
  const jwtOnly = await start(newJwt, oldCookie)
  const cookieOnly = await start(oldJwt, newCookie)
  const both = await start(newJwt, newCookie)
  const originalCookie = await issueSession(baseline, oldToken)
  const originalId = [...sessionIds][0]
  assert.ok(originalId)
  const originalStored = JSON.parse(await redis.get(`${prefix}${originalId}`))
  assert.equal(originalStored.auth_context.actor_id, authContext.actor_id)

  await t.test(
    "baseline accepts issued bearer and persistent cookie, rejects anonymous and wrong keys",
    async () => {
      await accepted(baseline, { token: oldToken })
      await accepted(baseline, { cookie: originalCookie })
      await rejected(baseline)
      await rejected(baseline, { token: newToken })
    }
  )
  await t.test(
    "JWT-only rotation rejects old bearer but preserves stored cookie and session precedence",
    async () => {
      await rejected(jwtOnly, { token: oldToken })
      await accepted(jwtOnly, { token: newToken })
      await accepted(jwtOnly, { cookie: originalCookie })
      await accepted(jwtOnly, { cookie: originalCookie, token: oldToken })
    }
  )
  await t.test(
    "cookie-only rotation rejects old cookie but leaves old bearer valid",
    async () => {
      await rejected(cookieOnly, { cookie: originalCookie })
      await accepted(cookieOnly, { token: oldToken })
      await accepted(cookieOnly, { cookie: originalCookie, token: oldToken })
    }
  )
  await t.test(
    "both-secret rotation rejects old bearer, old cookie and their combination without erasing session data",
    async () => {
      await rejected(both, { token: oldToken })
      await rejected(both, { cookie: originalCookie })
      await rejected(both, { token: oldToken, cookie: originalCookie })
      const retained = JSON.parse(await redis.get(`${prefix}${originalId}`))
      assert.deepEqual(retained.auth_context, originalStored.auth_context)
    }
  )
  await t.test(
    "new-key bearer can establish a new valid session; old instances reject the new keys",
    async () => {
      await accepted(both, { token: newToken })
      const newSessionCookie = await issueSession(both, newToken)
      await accepted(both, { cookie: newSessionCookie })
      await rejected(baseline, { cookie: newSessionCookie })
      await rejected(baseline, { token: newToken })
      assert.equal(sessionIds.size, 2)
    }
  )
})
