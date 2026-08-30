import {
  buildOperationalIncidentSnapshot,
  evaluateOperationalIncidentHealth,
} from "./incidents"

describe("operational incident health", () => {
  it("builds a bounded snapshot without order, cart, or provider data", () => {
    const snapshot = buildOperationalIncidentSnapshot(
      "payment_tax_mismatch",
      new Date("2026-08-30T12:00:00.000Z")
    )

    expect(snapshot).toMatchObject({
      event: "operations.incident.recorded",
      incident_type: "payment_tax_mismatch",
      recorded_at: "2026-08-30T12:00:00.000Z",
    })
    expect(JSON.stringify(snapshot)).not.toMatch(/cart|order|payment_intent/iu)
  })

  it("alerts while a valid incident latch exists", () => {
    const health = evaluateOperationalIncidentHealth({
      incidentValues: [
        JSON.stringify(buildOperationalIncidentSnapshot("webhook_failure")),
      ],
      redisAvailable: true,
    })

    expect(health).toMatchObject({
      reasons: ["incident_webhook_failure"],
      status: "degraded",
    })
  })

  it("fails closed when Redis is unavailable", () => {
    expect(
      evaluateOperationalIncidentHealth({
        incidentValues: [],
        redisAvailable: false,
      })
    ).toMatchObject({ reasons: ["redis_unavailable"], status: "degraded" })
  })
})
