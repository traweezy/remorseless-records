import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const redisMocks = vi.hoisted(() => ({
  eval: vi.fn(),
  getSharedRedisClient: vi.fn(),
  withRedisTimeout: vi.fn(),
}))

vi.mock("@/lib/redis/client", () => ({
  getSharedRedisClient: redisMocks.getSharedRedisClient,
  withRedisTimeout: redisMocks.withRedisTimeout,
}))

import { consumeRateLimit } from "@/lib/security/rate-limit"

const createRequest = (ip: string, userAgent = "rate-limit-test"): Request =>
  new Request("https://storefront.test/api/search/products", {
    method: "POST",
    headers: {
      "user-agent": userAgent,
      "x-real-ip": ip,
    },
  })

const policy = {
  key: "test:distributed",
  max: 3,
  windowMs: 60_000,
  onUnavailable: "reject" as const,
}

describe("Storefront distributed rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("RAILWAY_PROJECT_ID", "project-test")
    vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "environment-test")
    vi.stubEnv("RAILWAY_SERVICE_ID", "service-test")
    vi.stubEnv("CART_COOKIE_SECRET", "test-rate-limit-secret-at-least-32-chars")
    redisMocks.getSharedRedisClient.mockResolvedValue({
      eval: redisMocks.eval,
    })
    redisMocks.withRedisTimeout.mockImplementation(
      (operation: Promise<unknown>) => operation
    )
    redisMocks.eval.mockResolvedValue([1, 60_000])
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("uses HMAC keys without persisting raw IPs or User-Agent", async () => {
    await consumeRateLimit(createRequest("192.0.2.50", "agent-one"), policy)
    await consumeRateLimit(createRequest("192.0.2.50", "agent-two"), policy)

    const firstOptions = redisMocks.eval.mock.calls[0]?.[1] as
      | { keys?: string[] }
      | undefined
    const secondOptions = redisMocks.eval.mock.calls[1]?.[1] as
      | { keys?: string[] }
      | undefined
    const firstKey = firstOptions?.keys?.[0]
    expect(firstKey).toMatch(
      /^rr:rate:v1:storefront:test:distributed:[a-f0-9]{64}$/
    )
    expect(firstKey).not.toContain("192.0.2.50")
    expect(firstKey).not.toContain("agent-one")
    expect(secondOptions?.keys?.[0]).toBe(firstKey)
  })

  it("returns an atomic Redis limit decision with bounded retry timing", async () => {
    redisMocks.eval.mockResolvedValue([4, 2_750])

    await expect(
      consumeRateLimit(createRequest("192.0.2.51"), policy)
    ).resolves.toEqual({ status: "limited", retryAfterSeconds: 3 })

    expect(redisMocks.eval.mock.calls[0]?.[0]).toContain(
      'redis.call("INCR", KEYS[1])'
    )
    expect(redisMocks.eval.mock.calls[0]?.[0]).toContain(
      'redis.call("PEXPIRE", KEYS[1], ARGV[1])'
    )
  })

  it("shares concurrent decisions through the Redis counter", async () => {
    let count = 0
    redisMocks.eval.mockImplementation(() => {
      count += 1
      return Promise.resolve([count, 60_000])
    })

    const decisions = await Promise.all(
      Array.from({ length: 4 }, () =>
        consumeRateLimit(createRequest("192.0.2.52"), policy)
      )
    )

    expect(decisions.filter(({ status }) => status === "allowed")).toHaveLength(
      3
    )
    expect(decisions.at(-1)).toEqual({
      status: "limited",
      retryAfterSeconds: 60,
    })
  })

  it("fails closed when a protected limiter is unavailable", async () => {
    redisMocks.getSharedRedisClient.mockRejectedValue(
      new Error("connection unavailable")
    )

    await expect(
      consumeRateLimit(createRequest("192.0.2.53"), policy)
    ).resolves.toEqual({ status: "unavailable" })
  })

  it("uses a bounded local fallback for availability-sensitive reads", async () => {
    redisMocks.getSharedRedisClient.mockRejectedValue(
      new Error("connection unavailable")
    )
    const fallbackPolicy = {
      ...policy,
      key: "test:local-fallback",
      max: 1,
      onUnavailable: "local-fallback" as const,
    }

    await expect(
      consumeRateLimit(createRequest("192.0.2.54"), fallbackPolicy)
    ).resolves.toEqual({ status: "allowed" })
    await expect(
      consumeRateLimit(createRequest("192.0.2.54"), fallbackPolicy)
    ).resolves.toMatchObject({ status: "limited" })
  })
})
