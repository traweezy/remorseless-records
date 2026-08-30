import { randomUUID } from "node:crypto"

import {
  getSharedRedisClient,
  withRedisTimeout,
} from "../shared-redis-client"
import {
  ANONYMOUS_CART_RETENTION_HEALTH_KEY,
  RETENTION_HEALTH_TTL_SECONDS,
  buildRetentionSnapshot,
  evaluateRetentionHealth,
  recordRetentionHealth,
} from "./retention"

jest.mock("../shared-redis-client", () => ({
  getSharedRedisClient: jest.fn(),
  withRedisTimeout: jest.fn((operation: Promise<unknown>) => operation),
}))

const getSharedRedisClientMock = jest.mocked(getSharedRedisClient)
const withRedisTimeoutMock = jest.mocked(withRedisTimeout)
const setMock = jest.fn()
const now = new Date("2026-08-30T12:00:00.000Z")

const retentionSnapshot = (
  job: "abandoned_checkout" | "anonymous_cart",
  status: "completed" | "disabled" | "failed" = "completed",
  recordedAt = new Date("2026-08-30T11:00:00.000Z")
) =>
  buildRetentionSnapshot(
    {
      capped: false,
      cutoff: "2026-07-24T11:00:00.000Z",
      deleted: 3,
      durationMs: 42.5678,
      job,
      runId: randomUUID(),
      scanned: 10,
      startedAt: new Date("2026-08-30T10:59:59.000Z"),
      status,
    },
    recordedAt
  )

describe("retention health", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getSharedRedisClientMock.mockResolvedValue({ set: setMock } as never)
    withRedisTimeoutMock.mockImplementation(
      (operation: Promise<unknown>) => operation
    )
    setMock.mockResolvedValue("OK")
  })

  it("builds a bounded count-only snapshot", () => {
    const snapshot = retentionSnapshot("anonymous_cart")

    expect(snapshot).toMatchObject({
      deleted: 3,
      duration_ms: 42.568,
      event: "job.retention.anonymous_cart.completed",
      scanned: 10,
      status: "completed",
    })
    expect(JSON.stringify(snapshot)).not.toContain("email")
  })

  it("persists a bounded snapshot with an expiry", async () => {
    const snapshot = retentionSnapshot("anonymous_cart")

    await expect(recordRetentionHealth(snapshot)).resolves.toBe(true)
    expect(setMock).toHaveBeenCalledWith(
      ANONYMOUS_CART_RETENTION_HEALTH_KEY,
      JSON.stringify(snapshot),
      { EX: RETENTION_HEALTH_TTL_SECONDS }
    )
  })

  it("accepts recent completed or explicitly disabled jobs", () => {
    const health = evaluateRetentionHealth({
      abandonedCheckoutValue: JSON.stringify(
        retentionSnapshot("abandoned_checkout", "disabled")
      ),
      anonymousCartValue: JSON.stringify(retentionSnapshot("anonymous_cart")),
      now,
      redisAvailable: true,
    })

    expect(health).toMatchObject({ reasons: [], status: "healthy" })
  })

  it("fails closed on missing, stale, failed, or unavailable state", () => {
    const stale = retentionSnapshot(
      "anonymous_cart",
      "completed",
      new Date("2026-08-28T12:00:00.000Z")
    )
    const failed = retentionSnapshot("abandoned_checkout", "failed")
    const health = evaluateRetentionHealth({
      abandonedCheckoutValue: JSON.stringify(failed),
      anonymousCartValue: JSON.stringify(stale),
      now,
      redisAvailable: false,
    })

    expect(health.reasons).toEqual(
      expect.arrayContaining([
        "abandoned_checkout_latest_failed",
        "anonymous_cart_heartbeat_stale",
        "redis_unavailable",
      ])
    )
  })
})
