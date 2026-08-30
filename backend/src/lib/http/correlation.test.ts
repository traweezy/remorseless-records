import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import {
  attachRequestCorrelation,
  createRequestCorrelation,
  sendApiProblem,
} from "./correlation"

const TRACE_ID = "0123456789abcdef0123456789abcdef"
const PARENT_ID = "0123456789abcdef"

describe("Backend HTTP request correlation", () => {
  it("accepts bounded request IDs and continues valid W3C traces", () => {
    const correlation = createRequestCorrelation({
      traceparent: `00-${TRACE_ID}-${PARENT_ID}-00`,
      "x-request-id": "request_01:test",
    })

    expect(correlation).toMatchObject({
      requestId: "request_01:test",
      traceId: TRACE_ID,
      traceFlags: "00",
    })
    expect(correlation.spanId).toMatch(/^[0-9a-f]{16}$/u)
    expect(correlation.spanId).not.toBe(PARENT_ID)
  })

  it.each([
    ["request ID with spaces", `00-${TRACE_ID}-${PARENT_ID}-01`],
    ["a".repeat(129), `00-${TRACE_ID}-${PARENT_ID}-01`],
    ["request_01", `00-${"0".repeat(32)}-${PARENT_ID}-01`],
    ["request_01", `00-${TRACE_ID}-${"0".repeat(16)}-01`],
    ["request_01", `ff-${TRACE_ID}-${PARENT_ID}-01`],
    ["request_01", "not-a-traceparent"],
  ])("replaces unsafe correlation input", (requestId, traceparent) => {
    const correlation = createRequestCorrelation({
      traceparent,
      "x-request-id": requestId,
    })

    if (requestId !== "request_01") {
      expect(correlation.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
      )
    }
    expect(correlation.traceId).toMatch(/^[0-9a-f]{32}$/u)
    expect(correlation.traceId).not.toBe("0".repeat(32))
  })

  it("returns correlated RFC 7807 responses", () => {
    const json = jest.fn()
    const response = {
      json,
      locals: {},
      setHeader: jest.fn(),
      status: jest.fn(),
      type: jest.fn(),
    }
    response.status.mockReturnValue(response)
    const request = {
      headers: {
        traceparent: `00-${TRACE_ID}-${PARENT_ID}-01`,
        "x-request-id": "request_02",
      },
      path: "/store/example",
    } as unknown as MedusaRequest

    attachRequestCorrelation(request, response as unknown as MedusaResponse)
    sendApiProblem(request, response as unknown as MedusaResponse, {
      code: "example_conflict",
      title: "Example conflict",
      status: 409,
      detail: "Retry with current state.",
      instance: request.path,
    })

    expect(response.type).toHaveBeenCalledWith("application/problem+json")
    expect(response.status).toHaveBeenCalledWith(409)
    expect(json).toHaveBeenCalledWith({
      type: "https://remorselessrecords.com/problems/example_conflict",
      title: "Example conflict",
      status: 409,
      detail: "Retry with current state.",
      code: "example_conflict",
      instance: "/store/example",
      request_id: "request_02",
      trace_id: TRACE_ID,
    })
  })
})
