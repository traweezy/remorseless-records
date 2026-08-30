import { getSharedRedisClient, withRedisTimeout } from "../shared-redis-client"
import { consumeRateLimit } from "./rate-limit"

jest.mock("../shared-redis-client", () => ({
  getSharedRedisClient: jest.fn(),
  withRedisTimeout: jest.fn((operation: Promise<unknown>) => operation),
}))

const getSharedRedisClientMock = jest.mocked(getSharedRedisClient)
const withRedisTimeoutMock = jest.mocked(withRedisTimeout)
const evalMock = jest.fn()

const policy = {
  key: "test:distributed",
  max: 3,
  windowMs: 60_000,
  onUnavailable: "reject" as const,
}

describe("Backend distributed rate limiting", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getSharedRedisClientMock.mockResolvedValue({ eval: evalMock } as never)
    withRedisTimeoutMock.mockImplementation(
      (operation: Promise<unknown>) => operation
    )
    evalMock.mockResolvedValue([1, 60_000])
  })

  it("uses HMAC keys without persisting raw client IPs", async () => {
    await consumeRateLimit("192.0.2.50", policy)

    const evalOptions = evalMock.mock.calls[0]?.[1] as
      { keys?: string[] } | undefined
    const redisKey = evalOptions?.keys?.[0]
    expect(redisKey).toMatch(
      /^rr:rate:v1:backend:test:distributed:[a-f0-9]{64}$/
    )
    expect(redisKey).not.toContain("192.0.2.50")
  })

  it("returns an atomic Redis limit decision with bounded retry timing", async () => {
    evalMock.mockResolvedValue([4, 2_750])

    await expect(consumeRateLimit("192.0.2.51", policy)).resolves.toEqual({
      status: "limited",
      retryAfterSeconds: 3,
    })
    expect(evalMock.mock.calls[0]?.[0]).toContain('redis.call("INCR", KEYS[1])')
    expect(evalMock.mock.calls[0]?.[0]).toContain(
      'redis.call("PEXPIRE", KEYS[1], ARGV[1])'
    )
  })

  it("shares concurrent decisions through the Redis counter", async () => {
    let count = 0
    evalMock.mockImplementation(() => {
      count += 1
      return Promise.resolve([count, 60_000])
    })

    const decisions = await Promise.all(
      Array.from({ length: 4 }, () => consumeRateLimit("192.0.2.52", policy))
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
    getSharedRedisClientMock.mockRejectedValue(
      new Error("connection unavailable")
    )

    await expect(consumeRateLimit("192.0.2.53", policy)).resolves.toEqual({
      status: "unavailable",
    })
  })

  it("uses a bounded local fallback for availability-sensitive reads", async () => {
    getSharedRedisClientMock.mockRejectedValue(
      new Error("connection unavailable")
    )
    const fallbackPolicy = {
      ...policy,
      key: "test:local-fallback",
      max: 1,
      onUnavailable: "local-fallback" as const,
    }

    await expect(
      consumeRateLimit("192.0.2.54", fallbackPolicy)
    ).resolves.toEqual({ status: "allowed" })
    await expect(
      consumeRateLimit("192.0.2.54", fallbackPolicy)
    ).resolves.toMatchObject({ status: "limited" })
  })
})
