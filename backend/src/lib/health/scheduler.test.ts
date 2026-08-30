import { getSharedRedisClient, withRedisTimeout } from "../shared-redis-client"
import {
  CHECKOUT_SCHEDULER_HEARTBEAT_KEY,
  CHECKOUT_SCHEDULER_HEARTBEAT_TTL_SECONDS,
  CHECKOUT_SCHEDULER_INCIDENT_KEY,
  CHECKOUT_SCHEDULER_INCIDENT_TTL_SECONDS,
  CHECKOUT_SCHEDULER_MAX_REDIS_LATENCY_MS,
  buildCheckoutSchedulerSnapshot,
  evaluateCheckoutSchedulerHealth,
  recordCheckoutSchedulerHealth,
} from "./scheduler"

jest.mock("../shared-redis-client", () => ({
  getSharedRedisClient: jest.fn(),
  withRedisTimeout: jest.fn((operation: Promise<unknown>) => operation),
}))

const getSharedRedisClientMock = jest.mocked(getSharedRedisClient)
const withRedisTimeoutMock = jest.mocked(withRedisTimeout)
const setMock = jest.fn()

const now = new Date("2026-08-29T21:00:00.000Z")
const commitSha = "a".repeat(40)

const schedulerEvent = (overrides: Record<string, unknown> = {}) => ({
  attempted: 0,
  capped: false,
  commit_sha: commitSha,
  completed: 0,
  duration_ms: 72.676,
  eligible: 0,
  event: "job.checkout_reconciliation.completed",
  event_loop_delay_max_ms: 20.267,
  failed: 0,
  heldForReview: 0,
  lock_released: true,
  lock_wait_ms: 2.395,
  private_detail: "private@example.com",
  scanWindowFull: false,
  scanned: 797,
  schedule_delay_ms: 64,
  timeCapped: false,
  ...overrides,
})

const snapshot = (
  overrides: Record<string, unknown> = {},
  recordedAt = new Date("2026-08-29T20:59:00.000Z")
) => buildCheckoutSchedulerSnapshot(schedulerEvent(overrides), recordedAt)

const evaluate = ({
  incidentValue = null,
  latestValue = JSON.stringify(snapshot()),
  redisAvailable = true,
  redisLatencyMs = 12.345,
}: {
  incidentValue?: string | null
  latestValue?: string | null
  redisAvailable?: boolean
  redisLatencyMs?: number | null
} = {}) =>
  evaluateCheckoutSchedulerHealth({
    incidentValue,
    latestValue,
    now,
    redisAvailable,
    redisLatencyMs,
  })

describe("checkout scheduler health", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getSharedRedisClientMock.mockResolvedValue({ set: setMock } as never)
    withRedisTimeoutMock.mockImplementation(
      (operation: Promise<unknown>) => operation
    )
    setMock.mockResolvedValue("OK")
  })

  it("builds a bounded snapshot without copying unknown fields", () => {
    const value = snapshot()

    expect(value).toMatchObject({
      commit_sha: commitSha,
      event: "job.checkout_reconciliation.completed",
      held_for_review: 0,
      lock_released: true,
      status: "completed",
    })
    expect(JSON.stringify(value)).not.toContain("private@example.com")
  })

  it("reports a recent completion and Redis ping as healthy", () => {
    const health = evaluate()

    expect(health).toMatchObject({
      heartbeat_age_seconds: 60,
      incident: null,
      observation_window_seconds: CHECKOUT_SCHEDULER_INCIDENT_TTL_SECONDS,
      reasons: [],
      redis: "ok",
      redis_latency_ms: 12.345,
      status: "healthy",
    })
  })

  it("keeps an anomalous event degraded for the incident TTL", () => {
    const incident = snapshot({
      event: "job.checkout_reconciliation.attention",
      heldForReview: 1,
    })
    const health = evaluate({ incidentValue: JSON.stringify(incident) })

    expect(health.status).toBe("degraded")
    expect(health.incident?.status).toBe("attention")
    expect(health.reasons).toContain("scheduler_incident_latched")
  })

  it("refreshes the bounded heartbeat without latching a completion", async () => {
    await expect(recordCheckoutSchedulerHealth(schedulerEvent())).resolves.toBe(
      true
    )

    expect(setMock).toHaveBeenCalledTimes(1)
    expect(setMock).toHaveBeenCalledWith(
      CHECKOUT_SCHEDULER_HEARTBEAT_KEY,
      expect.any(String),
      { EX: CHECKOUT_SCHEDULER_HEARTBEAT_TTL_SECONDS }
    )
    expect(setMock.mock.calls[0]?.[1]).not.toContain("private@example.com")
  })

  it("latches an anomalous event for the full observation window", async () => {
    await expect(
      recordCheckoutSchedulerHealth(
        schedulerEvent({ event: "job.checkout_reconciliation.attention" })
      )
    ).resolves.toBe(true)

    expect(setMock).toHaveBeenCalledTimes(2)
    expect(setMock).toHaveBeenNthCalledWith(
      2,
      CHECKOUT_SCHEDULER_INCIDENT_KEY,
      expect.any(String),
      { EX: CHECKOUT_SCHEDULER_INCIDENT_TTL_SECONDS }
    )
  })

  it("fails closed on stale, missing, invalid, or unavailable state", () => {
    expect(
      evaluate({
        latestValue: JSON.stringify(
          snapshot({}, new Date("2026-08-29T20:45:00.000Z"))
        ),
      }).reasons
    ).toContain("scheduler_heartbeat_stale")
    expect(evaluate({ latestValue: null }).reasons).toContain(
      "scheduler_heartbeat_missing"
    )
    expect(evaluate({ latestValue: "not-json" }).reasons).toContain(
      "scheduler_state_invalid"
    )
    expect(
      evaluate({
        latestValue: JSON.stringify(
          snapshot({}, new Date("2026-08-29T21:02:00.000Z"))
        ),
      }).reasons
    ).toContain("scheduler_heartbeat_from_future")
    expect(evaluate({ redisAvailable: false }).reasons).toContain(
      "redis_unavailable"
    )
  })

  it("fails closed on missing or elevated Redis latency", () => {
    expect(evaluate({ redisLatencyMs: null }).reasons).toContain(
      "redis_latency_missing"
    )
    expect(
      evaluate({ redisLatencyMs: CHECKOUT_SCHEDULER_MAX_REDIS_LATENCY_MS })
        .reasons
    ).toContain("redis_latency_high")
  })
})
