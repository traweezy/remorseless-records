import { NextRequest } from "next/server"
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

import { enforceCartRateLimit } from "@/lib/security/cart-rate-limit"

const createRequest = (
  method: "GET" | "POST",
  ip = "192.0.2.50",
  userAgent = "cart-rate-limit-test"
): NextRequest =>
  new NextRequest("https://storefront.test/api/cart/items", {
    method,
    headers: {
      "user-agent": userAgent,
      "x-real-ip": ip,
    },
  })

const policy = {
  key: "api:cart:item:add",
  max: 3,
  windowMs: 60_000,
}

describe("distributed cart rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("RAILWAY_PROJECT_ID", "project-test")
    vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "environment-test")
    vi.stubEnv("RAILWAY_SERVICE_ID", "service-test")
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

  it("allows requests below the Redis-backed limit without storing raw IPs", async () => {
    await expect(
      enforceCartRateLimit(createRequest("POST"), policy)
    ).resolves.toBeNull()

    const evalOptions = redisMocks.eval.mock.calls[0]?.[1] as
      | { keys?: string[] }
      | undefined
    const redisKey = evalOptions?.keys?.[0]
    expect(redisKey).toMatch(
      /^rr:rate:v1:storefront:api:cart:item:add:[a-f0-9]{64}$/
    )
    expect(redisKey).not.toContain("192.0.2.50")
  })

  it("keeps the same identity when User-Agent changes", async () => {
    await enforceCartRateLimit(
      createRequest("POST", "192.0.2.50", "first-agent"),
      policy
    )
    await enforceCartRateLimit(
      createRequest("POST", "192.0.2.50", "second-agent"),
      policy
    )

    const firstOptions = redisMocks.eval.mock.calls[0]?.[1] as
      | { keys?: string[] }
      | undefined
    const secondOptions = redisMocks.eval.mock.calls[1]?.[1] as
      | { keys?: string[] }
      | undefined
    expect(secondOptions?.keys?.[0]).toBe(firstOptions?.keys?.[0])
  })

  it("returns a retryable problem after the distributed limit", async () => {
    redisMocks.eval.mockResolvedValue([4, 2_750])

    const response = await enforceCartRateLimit(createRequest("POST"), policy)

    expect(response?.status).toBe(429)
    expect(response?.headers.get("Retry-After")).toBe("3")
    await expect(response?.json()).resolves.toMatchObject({
      code: "cart_rate_limited",
    })
  })

  it("fails closed for mutations when Redis is unavailable", async () => {
    redisMocks.getSharedRedisClient.mockRejectedValue(
      new Error("connection unavailable")
    )

    const response = await enforceCartRateLimit(createRequest("POST"), policy)

    expect(response?.status).toBe(503)
    await expect(response?.json()).resolves.toMatchObject({
      code: "cart_rate_limit_unavailable",
    })
  })

  it("uses a bounded in-memory fallback for reads during Redis outages", async () => {
    redisMocks.getSharedRedisClient.mockRejectedValue(
      new Error("connection unavailable")
    )

    await expect(
      enforceCartRateLimit(createRequest("GET", "192.0.2.51"), policy)
    ).resolves.toBeNull()
  })
})
