import { beforeEach, describe, expect, it, vi } from "vitest"

import { buildBrowserTelemetryEvent } from "@/lib/observability/browser-event.server"

import { POST } from "./route"

const trustedHeaders = {
  "content-type": "application/json",
  origin: "https://storefront.test",
  referer: "https://storefront.test/catalog",
  "sec-fetch-site": "same-origin",
}

describe("browser telemetry route", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("builds a privacy-bounded event without URL or browser identity", () => {
    const request = new Request("https://storefront.test/private?email=a@b.c")
    const event = buildBrowserTelemetryEvent(
      request,
      { kind: "web_vital", name: "LCP", rating: "good", value: 123.4567 },
      new Date("2026-08-30T12:00:00.000Z")
    )
    const serialized = JSON.stringify(event)

    expect(event).toMatchObject({
      event: "browser.web_vital",
      metric_name: "LCP",
      metric_rating: "good",
      metric_value: 123.457,
      recorded_at: "2026-08-30T12:00:00.000Z",
      service: "storefront",
    })
    expect(serialized).not.toContain("private")
    expect(serialized).not.toContain("email")
  })

  it("accepts a strict same-origin metric payload", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined)
    const response = await POST(
      new Request("https://storefront.test/api/telemetry/browser", {
        body: JSON.stringify({
          kind: "web_vital",
          name: "CLS",
          rating: "good",
          value: 0.01,
        }),
        headers: trustedHeaders,
        method: "POST",
      })
    )

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ accepted: true })
    expect(log).toHaveBeenCalledOnce()
  })

  it("rejects payloads that try to attach routes or customer data", async () => {
    const response = await POST(
      new Request("https://storefront.test/api/telemetry/browser", {
        body: JSON.stringify({
          email: "private@example.com",
          kind: "web_vital",
          name: "CLS",
          rating: "good",
          route: "/checkout",
          value: 0.01,
        }),
        headers: trustedHeaders,
        method: "POST",
      })
    )

    expect(response.status).toBe(400)
  })
})
