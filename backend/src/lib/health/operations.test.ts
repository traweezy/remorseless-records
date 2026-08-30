import { evaluateOperationalIncidentHealth } from "./incidents"
import { evaluateOperationsHealth } from "./operations"
import { evaluateRetentionHealth } from "./retention"
import {
  buildCheckoutSchedulerSnapshot,
  evaluateCheckoutSchedulerHealth,
} from "./scheduler"

const now = new Date("2026-08-30T12:00:00.000Z")
const scheduler = evaluateCheckoutSchedulerHealth({
  incidentValue: null,
  latestValue: JSON.stringify(
    buildCheckoutSchedulerSnapshot(
      {
        commit_sha: "a".repeat(40),
        event: "job.checkout_reconciliation.completed",
      },
      new Date("2026-08-30T11:59:00.000Z")
    )
  ),
  now,
  redisAvailable: true,
  redisLatencyMs: 10,
})
const retention = evaluateRetentionHealth({
  abandonedCheckoutValue: null,
  anonymousCartValue: null,
  now,
  redisAvailable: true,
})
const incidents = evaluateOperationalIncidentHealth({
  incidentValues: [],
  now,
  redisAvailable: true,
})

describe("operations health", () => {
  it("aggregates component and dependency failures with bounded codes", () => {
    const health = evaluateOperationsHealth({
      dependencies: [
        { duration_ms: 1_000, name: "database", status: "ok" },
        { duration_ms: 12, name: "object_storage", status: "error" },
      ],
      incidents,
      now,
      retention,
      scheduler,
    })

    expect(health.status).toBe("degraded")
    expect(health.reasons).toEqual(
      expect.arrayContaining([
        "dependency:database_latency_high",
        "dependency:object_storage_error",
        "retention:abandoned_checkout_heartbeat_missing",
        "retention:anonymous_cart_heartbeat_missing",
      ])
    )
  })
})
