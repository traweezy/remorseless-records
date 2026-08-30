import { buildBackendRuntimeEvent } from "./runtime-event"

describe("backend runtime events", () => {
  it("builds a bounded event without request or customer data", () => {
    const event = buildBackendRuntimeEvent(
      "redis.connection.ready",
      "Shared Redis connection is ready",
      new Date("2026-08-30T12:00:00.000Z")
    )

    expect(event).toMatchObject({
      event: "redis.connection.ready",
      message: "Shared Redis connection is ready",
      recorded_at: "2026-08-30T12:00:00.000Z",
      request_id: "unknown",
      service: "backend",
      span_id: "unknown",
      trace_id: "unknown",
    })
  })

  it("rejects unbounded or malformed values", () => {
    expect(() => buildBackendRuntimeEvent("bad event", "message")).toThrow(
      TypeError
    )
    expect(() =>
      buildBackendRuntimeEvent("redis.connection.error", "x".repeat(161))
    ).toThrow(TypeError)
    expect(() =>
      buildBackendRuntimeEvent(
        "redis.connection.error",
        "message",
        new Date("invalid")
      )
    ).toThrow(TypeError)
  })
})
