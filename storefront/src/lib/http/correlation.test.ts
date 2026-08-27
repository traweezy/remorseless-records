import { describe, expect, it } from "vitest"

import {
  applyCorrelationToResponse,
  createRequestCorrelation,
  createUpstreamHeaders,
  getRequestCorrelation,
} from "@/lib/http/correlation"

const TRACE_ID = "0123456789abcdef0123456789abcdef"
const PARENT_ID = "0123456789abcdef"

describe("HTTP request correlation", () => {
  it("accepts a bounded request ID and continues a valid W3C trace", () => {
    const correlation = createRequestCorrelation(
      new Headers({
        traceparent: `00-${TRACE_ID}-${PARENT_ID}-00`,
        "x-request-id": "request_01:test",
      })
    )

    expect(correlation).toMatchObject({
      requestId: "request_01:test",
      traceId: TRACE_ID,
      traceFlags: "00",
    })
    expect(correlation.spanId).toMatch(/^[0-9a-f]{16}$/)
    expect(correlation.spanId).not.toBe(PARENT_ID)
    expect(correlation.traceparent).toBe(
      `00-${TRACE_ID}-${correlation.spanId}-00`
    )
  })

  it.each([
    ["request ID with spaces", `00-${TRACE_ID}-${PARENT_ID}-01`],
    ["a".repeat(129), `00-${TRACE_ID}-${PARENT_ID}-01`],
    ["request_01", `00-${"0".repeat(32)}-${PARENT_ID}-01`],
    ["request_01", `00-${TRACE_ID}-${"0".repeat(16)}-01`],
    ["request_01", `ff-${TRACE_ID}-${PARENT_ID}-01`],
    ["request_01", "not-a-traceparent"],
  ])("replaces unsafe correlation input", (requestId, traceparent) => {
    const correlation = createRequestCorrelation(
      new Headers({ traceparent, "x-request-id": requestId })
    )

    if (requestId !== "request_01") {
      expect(correlation.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      )
    }
    expect(correlation.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(correlation.traceId).not.toBe("0".repeat(32))
  })

  it("keeps one request context and creates child spans upstream", () => {
    const request = new Request("https://storefront.test/api/cart", {
      headers: {
        traceparent: `00-${TRACE_ID}-${PARENT_ID}-01`,
        "x-request-id": "request_02",
      },
    })

    const first = getRequestCorrelation(request)
    const second = getRequestCorrelation(request)
    const upstream = createUpstreamHeaders(request, {
      accept: "application/json",
    })

    expect(second).toBe(first)
    expect(upstream.get("x-request-id")).toBe("request_02")
    expect(upstream.get("accept")).toBe("application/json")
    expect(upstream.get("traceparent")).toMatch(
      new RegExp(`^00-${TRACE_ID}-[0-9a-f]{16}-01$`)
    )
    expect(upstream.get("traceparent")).not.toBe(first.traceparent)
  })

  it("returns correlation headers to the caller", () => {
    const correlation = createRequestCorrelation(new Headers())
    const response = applyCorrelationToResponse(
      Response.json({ ok: true }),
      correlation
    )

    expect(response.headers.get("X-Request-Id")).toBe(correlation.requestId)
    expect(response.headers.get("traceparent")).toBe(correlation.traceparent)
  })
})
