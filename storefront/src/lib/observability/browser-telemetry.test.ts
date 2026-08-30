import { describe, expect, it, vi } from "vitest"

import {
  sendClientErrorTelemetry,
  sendWebVitalTelemetry,
} from "./browser-telemetry"

const acceptedResponse = new Response(null, { status: 202 })

describe("browser telemetry client", () => {
  it("sends only a bounded Web Vital shape without route or user data", () => {
    const fetchImpl = vi.fn().mockResolvedValue(acceptedResponse)

    sendWebVitalTelemetry(
      {
        name: "LCP",
        rating: "needs-improvement",
        value: 1234.56789,
      },
      fetchImpl
    )

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/telemetry/browser",
      expect.objectContaining({
        body: JSON.stringify({
          kind: "web_vital",
          name: "LCP",
          rating: "needs-improvement",
          value: 1234.568,
        }),
        credentials: "omit",
        keepalive: true,
        referrerPolicy: "no-referrer",
      })
    )
  })

  it("drops unknown metrics and invalid values", () => {
    const fetchImpl = vi.fn().mockResolvedValue(acceptedResponse)

    sendWebVitalTelemetry(
      { name: "CUSTOM", rating: "good", value: 1 },
      fetchImpl
    )
    sendWebVitalTelemetry(
      { name: "CLS", rating: "good", value: Number.NaN },
      fetchImpl
    )

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("sends a normalized boundary digest without browser credentials", () => {
    const fetchImpl = vi.fn().mockResolvedValue(acceptedResponse)

    sendClientErrorTelemetry(
      { digest: "safe_digest", kind: "client_error", scope: "route" },
      fetchImpl
    )

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/telemetry/browser",
      expect.objectContaining({
        body: JSON.stringify({
          digest: "safe_digest",
          kind: "client_error",
          scope: "route",
        }),
        credentials: "omit",
      })
    )
  })
})
