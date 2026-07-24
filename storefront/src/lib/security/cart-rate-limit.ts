import "server-only"

import { createHmac } from "node:crypto"

import type { NextRequest } from "next/server"
import { z } from "zod"

import { getSharedRedisClient, withRedisTimeout } from "@/lib/redis/client"
import { enforceRateLimit, jsonApiProblem } from "@/lib/security/route-guards"

type CartRateLimitPolicy = {
  key: string
  max: number
  windowMs: number
}

const RATE_LIMIT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return { count, ttl }
`

const rateLimitResultSchema = z.tuple([
  z.coerce.number().int().positive(),
  z.coerce.number().int(),
])

const MINIMUM_SECRET_LENGTH = 32
const KEY_PREFIX = "rr:cart:rate:v1"
const DEVELOPMENT_SECRET = "dev-only-cart-rate-secret-change-me"

const extractClientSignal = (request: NextRequest): string => {
  const forwarded = request.headers.get("x-forwarded-for")
  const candidates = [
    forwarded?.split(",")[0]?.trim() ?? null,
    request.headers.get("x-real-ip")?.trim(),
    request.headers.get("cf-connecting-ip")?.trim(),
  ]
  const ip =
    candidates.find(
      (candidate): candidate is string =>
        typeof candidate === "string" && candidate.length > 0
    ) ?? "unknown"
  const userAgent = request.headers.get("user-agent")?.slice(0, 256) ?? ""
  return `${ip}\n${userAgent}`
}

const resolveHashSecret = (): string => {
  const configured = [
    process.env.CART_RATE_LIMIT_SECRET?.trim(),
    process.env.CART_COOKIE_SECRET?.trim(),
  ].find(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.length > 0
  )
  if (configured && configured.length >= MINIMUM_SECRET_LENGTH) {
    return configured
  }
  if (process.env.NODE_ENV !== "production") {
    return DEVELOPMENT_SECRET
  }
  throw new Error("Cart rate-limit secret unavailable")
}

const clientHash = (request: NextRequest): string =>
  createHmac("sha256", resolveHashSecret())
    .update(extractClientSignal(request))
    .digest("hex")

const unavailableResponse = (request: NextRequest): Response =>
  jsonApiProblem({
    status: 503,
    code: "cart_rate_limit_unavailable",
    title: "Cart service temporarily unavailable",
    detail: "Please wait a moment and try your cart request again.",
    instance: request.nextUrl.pathname,
  })

export const enforceCartRateLimit = async (
  request: NextRequest,
  policy: CartRateLimitPolicy
): Promise<Response | null> => {
  try {
    const client = await getSharedRedisClient()
    if (!client) {
      return enforceRateLimit(request, policy)
    }

    const key = `${KEY_PREFIX}:${policy.key}:${clientHash(request)}`
    const rawResult = await withRedisTimeout(
      client.eval(RATE_LIMIT_SCRIPT, {
        keys: [key],
        arguments: [String(policy.windowMs)],
      })
    )
    const parsed = rateLimitResultSchema.safeParse(rawResult)
    if (!parsed.success) {
      throw new Error("Invalid Redis rate-limit response")
    }

    const [count, ttlMs] = parsed.data
    if (count <= policy.max) {
      return null
    }

    const retryAfterSeconds = Math.max(1, Math.ceil(ttlMs / 1_000))
    console.warn("Cart request rate limited", {
      route_class: policy.key,
      retry_after_seconds: retryAfterSeconds,
    })
    const response = jsonApiProblem({
      status: 429,
      code: "cart_rate_limited",
      title: "Too many cart requests",
      detail: "Please wait a moment before trying your cart request again.",
      instance: request.nextUrl.pathname,
    })
    response.headers.set("Retry-After", String(retryAfterSeconds))
    return response
  } catch {
    if (request.method === "GET" || request.method === "HEAD") {
      return enforceRateLimit(request, policy)
    }
    console.error("Cart rate limiting unavailable")
    return unavailableResponse(request)
  }
}
