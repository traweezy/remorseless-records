import { createHash, createHmac } from "node:crypto"

import { z } from "zod"

import { getSharedRedisClient, withRedisTimeout } from "../shared-redis-client"

export type RateLimitPolicy = {
  key: string
  max: number
  windowMs: number
  onUnavailable: "local-fallback" | "reject"
}

export type RateLimitDecision =
  | { status: "allowed" }
  | { status: "limited"; retryAfterSeconds: number }
  | { status: "unavailable" }

type RateLimitBucket = {
  count: number
  resetAt: number
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

const localBuckets = new Map<string, RateLimitBucket>()

const MAX_LOCAL_BUCKETS = 10_000
const MINIMUM_SECRET_LENGTH = 32
const KEY_PREFIX = "rr:rate:v1:backend"
const DEVELOPMENT_SECRET = "dev-only-rate-limit-secret-change-me"

const resolveHashSecret = (): string => {
  const configured = process.env.COOKIE_SECRET?.trim()
  if (configured && configured.length >= MINIMUM_SECRET_LENGTH) {
    return configured
  }
  if (process.env.NODE_ENV !== "production") {
    return DEVELOPMENT_SECRET
  }
  throw new Error("Rate-limit key secret unavailable")
}

const evictLocalBucket = (now: number): void => {
  if (localBuckets.size < MAX_LOCAL_BUCKETS) {
    return
  }

  for (const [key, bucket] of localBuckets) {
    if (bucket.resetAt <= now) {
      localBuckets.delete(key)
    }
  }

  if (localBuckets.size >= MAX_LOCAL_BUCKETS) {
    const oldestKey = localBuckets.keys().next().value
    if (typeof oldestKey === "string") {
      localBuckets.delete(oldestKey)
    }
  }
}

const consumeLocalRateLimit = (
  identity: string,
  policy: RateLimitPolicy
): RateLimitDecision => {
  const now = Date.now()
  const identityHash = createHash("sha256").update(identity).digest("hex")
  const key = `${policy.key}:${identityHash}`
  const current = localBuckets.get(key)

  if (!current || current.resetAt <= now) {
    evictLocalBucket(now)
    localBuckets.set(key, {
      count: 1,
      resetAt: now + policy.windowMs,
    })
    return { status: "allowed" }
  }

  if (current.count >= policy.max) {
    return {
      status: "limited",
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((current.resetAt - now) / 1_000)
      ),
    }
  }

  current.count += 1
  localBuckets.set(key, current)
  return { status: "allowed" }
}

const distributedKey = (identity: string, policy: RateLimitPolicy): string => {
  const identityHash = createHmac("sha256", resolveHashSecret())
    .update(`${KEY_PREFIX}\n${identity}`)
    .digest("hex")
  return `${KEY_PREFIX}:${policy.key}:${identityHash}`
}

export const consumeRateLimit = async (
  identity: string,
  policy: RateLimitPolicy
): Promise<RateLimitDecision> => {
  try {
    const client = await getSharedRedisClient()
    if (!client) {
      return consumeLocalRateLimit(identity, policy)
    }

    const rawResult = await withRedisTimeout(
      client.eval(RATE_LIMIT_SCRIPT, {
        keys: [distributedKey(identity, policy)],
        arguments: [String(policy.windowMs)],
      })
    )
    const parsed = rateLimitResultSchema.safeParse(rawResult)
    if (!parsed.success) {
      throw new Error("Invalid Redis rate-limit response")
    }

    const [count, ttlMs] = parsed.data
    return count <= policy.max
      ? { status: "allowed" }
      : {
          status: "limited",
          retryAfterSeconds: Math.max(1, Math.ceil(ttlMs / 1_000)),
        }
  } catch {
    if (policy.onUnavailable === "local-fallback") {
      return consumeLocalRateLimit(identity, policy)
    }
    return { status: "unavailable" }
  }
}
