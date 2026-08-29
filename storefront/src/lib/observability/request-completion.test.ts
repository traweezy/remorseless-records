import type { ReadableSpan } from "@opentelemetry/sdk-trace-base"
import { describe, expect, it, vi } from "vitest"

import {
  BoundedRequestRegistry,
  StorefrontHttpCompletionProcessor,
} from "./request-completion"

const TRACE_ONE = "0123456789abcdef0123456789abcdef"
const TRACE_TWO = "1123456789abcdef0123456789abcdef"
const TRACE_THREE = "2123456789abcdef0123456789abcdef"
const SPAN_ID = "0123456789abcdef"

const readableSpan = (
  attributes: Record<string, string | number>,
  traceId = TRACE_ONE
): ReadableSpan =>
  ({
    attributes,
    duration: [0, 125_500_000],
    spanContext: () => ({
      isRemote: false,
      spanId: SPAN_ID,
      traceFlags: 1,
      traceId,
    }),
  }) as unknown as ReadableSpan

describe("Storefront request completion registry", () => {
  it("expires entries and consumes each request only once", () => {
    let now = 1_000
    const registry = new BoundedRequestRegistry({
      now: () => now,
      ttlMs: 100,
    })

    registry.register(TRACE_ONE, "request_01")
    expect(registry.lookup(TRACE_ONE)).toBe("request_01")
    expect(registry.consume(TRACE_ONE)).toBe("request_01")
    expect(registry.consume(TRACE_ONE)).toBeUndefined()

    registry.register(TRACE_ONE, "request_02")
    now = 1_100
    expect(registry.lookup(TRACE_ONE)).toBeUndefined()
    expect(registry.size).toBe(0)
  })

  it("bounds cardinality and rejects unsafe identifiers", () => {
    const registry = new BoundedRequestRegistry({ maxEntries: 2 })

    registry.register(TRACE_ONE, "request_01")
    registry.register(TRACE_TWO, "request_02")
    registry.register(TRACE_THREE, "request_03")
    registry.register("invalid", "request_04")
    registry.register(TRACE_ONE, "request ID with spaces")

    expect(registry.size).toBe(2)
    expect(registry.lookup(TRACE_ONE)).toBeUndefined()
    expect(registry.lookup(TRACE_TWO)).toBe("request_02")
    expect(registry.lookup(TRACE_THREE)).toBe("request_03")
  })
})

describe("Storefront HTTP completion processor", () => {
  it("writes a redacted final response event from the Next root span", () => {
    const registry = new BoundedRequestRegistry()
    const write = vi.fn()
    const processor = new StorefrontHttpCompletionProcessor({ registry, write })
    registry.register(TRACE_ONE, "request_01")

    processor.onEnd(
      readableSpan({
        "http.request.method": "POST",
        "http.response.status_code": 503,
        "http.target": "/api/contact?email=private@example.com",
        "next.span_type": "BaseServer.handleRequest",
      })
    )

    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith(
      "error",
      expect.objectContaining({
        duration_ms: 125.5,
        event: "http.request.completed",
        method: "POST",
        request_id: "request_01",
        service: "storefront",
        span_id: SPAN_ID,
        status: 503,
        trace_id: TRACE_ONE,
      })
    )
    const event = write.mock.calls[0]?.[1] as Record<string, unknown>
    expect(event).not.toHaveProperty("http.target")
    expect(event).not.toHaveProperty("path")
    expect(event).not.toHaveProperty("headers")
    expect(registry.size).toBe(0)
  })

  it("supports legacy Next attributes and ignores uncorrelated spans", () => {
    const registry = new BoundedRequestRegistry()
    const write = vi.fn()
    const processor = new StorefrontHttpCompletionProcessor({ registry, write })
    registry.register(TRACE_ONE, "request_02")

    processor.onEnd(
      readableSpan({
        "http.method": "GET",
        "http.status_code": 204,
        "next.span_type": "BaseServer.handleRequest",
      })
    )
    processor.onEnd(
      readableSpan({
        "http.method": "GET",
        "http.status_code": 200,
        "next.span_type": "AppRender.fetch",
      })
    )
    processor.onEnd(
      readableSpan(
        {
          "http.method": "GET",
          "http.status_code": 200,
          "next.span_type": "BaseServer.handleRequest",
        },
        TRACE_TWO
      )
    )

    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith(
      "info",
      expect.objectContaining({ method: "GET", status: 204 })
    )
  })
})

