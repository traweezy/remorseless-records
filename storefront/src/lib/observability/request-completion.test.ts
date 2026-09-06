import type { ReadableSpan } from "@opentelemetry/sdk-trace-base"
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base"
import { ROOT_CONTEXT, trace, type SpanContext } from "@opentelemetry/api"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  BoundedRequestRegistry,
  StorefrontHttpCompletionProcessor,
  getActiveTraceContext,
  logStorefrontRequestError,
  registerRequestCompletion,
} from "./request-completion"

const TRACE_ONE = "0123456789abcdef0123456789abcdef"
const TRACE_TWO = "1123456789abcdef0123456789abcdef"
const TRACE_THREE = "2123456789abcdef0123456789abcdef"
const SPAN_ID = "0123456789abcdef"
const PARENT_ID = "1123456789abcdef"
const SECOND_PARENT_ID = "2123456789abcdef"

const spanContext = (traceId = TRACE_ONE, spanId = PARENT_ID): SpanContext => ({
  traceId,
  spanId,
  traceFlags: 1,
  isRemote: true,
})

afterEach(() => vi.restoreAllMocks())

const readableSpan = (
  attributes: Record<string, string | number>,
  traceId = TRACE_ONE,
  parentSpanId = PARENT_ID
): ReadableSpan =>
  ({
    attributes,
    duration: [0, 125_500_000],
    parentSpanContext: spanContext(traceId, parentSpanId),
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

    registry.register(TRACE_ONE, PARENT_ID, "request_01")
    expect(registry.lookup(TRACE_ONE, PARENT_ID)).toBe("request_01")
    expect(registry.consume(TRACE_ONE, PARENT_ID, SPAN_ID)).toBeUndefined()
    expect(registry.claim(TRACE_ONE, PARENT_ID, SPAN_ID)).toBe(true)
    expect(registry.consume(TRACE_ONE, PARENT_ID, SPAN_ID)).toBe("request_01")
    expect(registry.consume(TRACE_ONE, PARENT_ID, SPAN_ID)).toBeUndefined()

    registry.register(TRACE_ONE, PARENT_ID, "request_02")
    now = 1_100
    expect(registry.lookup(TRACE_ONE, PARENT_ID)).toBeUndefined()
    expect(registry.size).toBe(0)
  })

  it("retains the first root owner without extending expiry", () => {
    let now = 1_000
    const registry = new BoundedRequestRegistry({ now: () => now, ttlMs: 100 })
    registry.register(TRACE_ONE, PARENT_ID, "owned_request")
    expect(registry.claim(TRACE_ONE, PARENT_ID, "invalid")).toBe(false)
    expect(registry.claim(TRACE_ONE, PARENT_ID, "0".repeat(16))).toBe(false)
    expect(registry.claim(TRACE_TWO, PARENT_ID, SPAN_ID)).toBe(false)
    expect(registry.claim(TRACE_ONE, PARENT_ID, SPAN_ID)).toBe(true)
    expect(registry.claim(TRACE_ONE, PARENT_ID, SECOND_PARENT_ID)).toBe(false)
    expect(
      registry.consume(TRACE_ONE, PARENT_ID, SECOND_PARENT_ID)
    ).toBeUndefined()
    now = 1_099
    expect(registry.claim(TRACE_ONE, PARENT_ID, SPAN_ID)).toBe(true)
    expect(registry.lookup(TRACE_ONE, PARENT_ID)).toBe("owned_request")
    now = 1_100
    expect(registry.claim(TRACE_ONE, PARENT_ID, SPAN_ID)).toBe(false)
    expect(registry.consume(TRACE_ONE, PARENT_ID, SPAN_ID)).toBeUndefined()
    expect(registry.size).toBe(0)
  })

  it("bounds cardinality and rejects unsafe identifiers", () => {
    const registry = new BoundedRequestRegistry({ maxEntries: 2 })

    registry.register(TRACE_ONE, PARENT_ID, "request_01")
    registry.register(TRACE_TWO, PARENT_ID, "request_02")
    registry.register(TRACE_THREE, PARENT_ID, "request_03")
    registry.register("invalid", PARENT_ID, "request_04")
    registry.register(TRACE_ONE, PARENT_ID, "request ID with spaces")
    registry.register("0".repeat(32), PARENT_ID, "request_04")
    registry.register(TRACE_ONE, "invalid", "request_04")
    registry.register(TRACE_ONE, "0".repeat(16), "request_04")

    expect(registry.size).toBe(2)
    expect(registry.lookup(TRACE_ONE, PARENT_ID)).toBeUndefined()
    expect(registry.lookup(TRACE_TWO, PARENT_ID)).toBe("request_02")
    expect(registry.lookup(TRACE_THREE, PARENT_ID)).toBe("request_03")
  })

  it("shares request state across separately bundled registry wrappers", () => {
    const requests = new Map<string, { expiresAt: number; requestId: string }>()
    const proxyRegistry = new BoundedRequestRegistry({ requests })
    const instrumentationRegistry = new BoundedRequestRegistry({ requests })

    proxyRegistry.register(TRACE_ONE, PARENT_ID, "request_cross_bundle_01")
    expect(instrumentationRegistry.claim(TRACE_ONE, PARENT_ID, SPAN_ID)).toBe(
      true
    )
    expect(proxyRegistry.claim(TRACE_ONE, PARENT_ID, SECOND_PARENT_ID)).toBe(
      false
    )

    expect(instrumentationRegistry.consume(TRACE_ONE, PARENT_ID, SPAN_ID)).toBe(
      "request_cross_bundle_01"
    )
    expect(proxyRegistry.size).toBe(0)
  })
})

describe("Storefront HTTP completion processor", () => {
  it("writes a redacted final response event from the Next root span", () => {
    const registry = new BoundedRequestRegistry()
    const recordMetric = vi.fn()
    const write = vi.fn()
    const processor = new StorefrontHttpCompletionProcessor({
      recordMetric,
      registry,
      write,
    })
    registry.register(TRACE_ONE, PARENT_ID, "request_01")
    registry.claim(TRACE_ONE, PARENT_ID, SPAN_ID)

    processor.onEnd(
      readableSpan({
        "http.request.method": "POST",
        "http.response.status_code": 503,
        "http.target": "/api/contact?email=private@example.com",
        "next.route": "/api/contact",
        "next.span_type": "BaseServer.handleRequest",
      })
    )

    expect(write).toHaveBeenCalledTimes(1)
    expect(recordMetric).toHaveBeenCalledWith({
      durationMs: 125.5,
      method: "POST",
      status: 503,
    })
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
    registry.register(TRACE_ONE, PARENT_ID, "request_02")
    registry.claim(TRACE_ONE, PARENT_ID, SPAN_ID)

    processor.onEnd(
      readableSpan({
        "http.method": "GET",
        "http.status_code": 204,
        "next.route": "/api/healthcheck",
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
          "next.route": "/api/healthcheck",
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

  it("ignores the pre-proxy root and accepts its exact route root without next.route", () => {
    const registry = new BoundedRequestRegistry()
    const write = vi.fn()
    const processor = new StorefrontHttpCompletionProcessor({ registry, write })
    registry.register(TRACE_ONE, PARENT_ID, "request_nested_route_01")
    registry.claim(TRACE_ONE, PARENT_ID, SPAN_ID)

    processor.onEnd(
      readableSpan(
        {
          "http.method": "GET",
          "http.status_code": 200,
          "next.span_type": "BaseServer.handleRequest",
        },
        TRACE_ONE,
        SECOND_PARENT_ID
      )
    )

    expect(write).not.toHaveBeenCalled()
    expect(registry.size).toBe(1)

    processor.onEnd(
      readableSpan({
        "http.method": "GET",
        "http.status_code": 400,
        "next.span_type": "BaseServer.handleRequest",
      })
    )

    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith(
      "info",
      expect.objectContaining({
        request_id: "request_nested_route_01",
        status: 400,
      })
    )
    expect(registry.size).toBe(0)
  })

  it("completes concurrent siblings in reverse order exactly once per request", () => {
    const registry = new BoundedRequestRegistry()
    const recordMetric = vi.fn()
    const write = vi.fn()
    const processor = new StorefrontHttpCompletionProcessor({
      registry,
      recordMetric,
      write,
    })
    registry.register(TRACE_ONE, PARENT_ID, "sibling_first")
    registry.register(TRACE_ONE, SECOND_PARENT_ID, "sibling_second")
    registry.claim(TRACE_ONE, PARENT_ID, SPAN_ID)
    registry.claim(TRACE_ONE, SECOND_PARENT_ID, SPAN_ID)
    const attributes = {
      "http.method": "GET",
      "http.status_code": 200,
      "next.span_type": "BaseServer.handleRequest",
    }
    const first = readableSpan(attributes)
    const second = readableSpan(attributes, TRACE_ONE, SECOND_PARENT_ID)
    processor.onEnd(second)
    processor.onEnd(first)
    processor.onEnd(second)
    expect(write.mock.calls.map((call) => call[1].request_id)).toEqual([
      "sibling_second",
      "sibling_first",
    ])
    expect(recordMetric).toHaveBeenCalledTimes(2)
    expect(registry.size).toBe(0)
  })

  it("rejects absent, invalid and cross-trace parents without consuming valid state", () => {
    const registry = new BoundedRequestRegistry()
    const write = vi.fn()
    const processor = new StorefrontHttpCompletionProcessor({ registry, write })
    registry.register(TRACE_ONE, PARENT_ID, "valid_request")
    registry.claim(TRACE_ONE, PARENT_ID, SPAN_ID)
    const attributes = { "next.span_type": "BaseServer.handleRequest" }
    for (const parentSpanContext of [
      undefined,
      spanContext(TRACE_ONE, "0".repeat(16)),
      spanContext(TRACE_TWO),
    ]) {
      processor.onEnd({
        ...readableSpan(attributes),
        parentSpanContext,
      } as ReadableSpan)
    }
    processor.onEnd({
      ...readableSpan(attributes),
      spanContext: () => spanContext("0".repeat(32)),
    })
    expect(write).not.toHaveBeenCalled()
    expect(registry.size).toBe(1)
    processor.onEnd(readableSpan(attributes))
    expect(write).toHaveBeenCalledWith(
      "error",
      expect.objectContaining({ method: "UNKNOWN", status: 0 })
    )
  })

  it("rejects an overlapping replay root without stealing completion or descendant errors", async () => {
    const writes = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined)
    const completion = vi.fn()
    const recordMetric = vi.fn()
    const processor = new StorefrontHttpCompletionProcessor({
      write: completion,
      recordMetric,
    })
    const provider = new BasicTracerProvider({ spanProcessors: [processor] })
    const tracer = provider.getTracer("completion-replay-regression")
    const active = vi.spyOn(trace, "getActiveSpan").mockReturnValue(undefined)
    const register = (parentId: string, requestId: string) => {
      registerRequestCompletion({
        traceId: TRACE_TWO,
        spanId: parentId,
        requestId,
        traceFlags: "01",
        traceparent: `00-${TRACE_TWO}-${parentId}-01`,
      })
    }
    const startRoot = (parentId: string, status: number) =>
      tracer.startSpan(
        "request",
        {
          attributes: {
            "next.span_type": "BaseServer.handleRequest",
            "http.method": "GET",
            "http.status_code": status,
          },
        },
        trace.setSpanContext(ROOT_CONTEXT, spanContext(TRACE_TWO, parentId))
      )
    register(PARENT_ID, "original_request")
    const originalRoot = startRoot(PARENT_ID, 503)
    const replayRoot = startRoot(PARENT_ID, 400)
    const replayChild = tracer.startSpan(
      "replay handler",
      {},
      trace.setSpan(ROOT_CONTEXT, replayRoot)
    )
    active.mockReturnValue(replayChild)
    logStorefrontRequestError({ method: "GET", routeType: "route" })
    expect(
      JSON.parse(String(writes.mock.calls.at(-1)?.[0]))
    ).not.toHaveProperty("request_id")

    // The replay's own proxy may register a fresh outgoing parent normally.
    const replayProxy = tracer.startSpan(
      "replay proxy",
      {},
      trace.setSpanContext(ROOT_CONTEXT, spanContext(TRACE_TWO, PARENT_ID))
    )
    active.mockReturnValue(replayProxy)
    register(SECOND_PARENT_ID, "second_request")
    const secondRoot = startRoot(SECOND_PARENT_ID, 201)
    active.mockReturnValue(secondRoot)
    logStorefrontRequestError({ method: "GET", routeType: "route" })
    expect(JSON.parse(String(writes.mock.calls.at(-1)?.[0]))).toHaveProperty(
      "request_id",
      "second_request"
    )
    active.mockReturnValue(originalRoot)
    logStorefrontRequestError({ method: "GET", routeType: "route" })
    expect(JSON.parse(String(writes.mock.calls.at(-1)?.[0]))).toHaveProperty(
      "request_id",
      "original_request"
    )

    replayChild.end()
    replayRoot.end()
    replayProxy.end()
    expect(completion).not.toHaveBeenCalled()
    expect(recordMetric).not.toHaveBeenCalled()
    secondRoot.end()
    originalRoot.end()
    expect(
      completion.mock.calls.map((call) => ({
        level: call[0],
        requestId: call[1].request_id,
        status: call[1].status,
      }))
    ).toEqual([
      { level: "info", requestId: "second_request", status: 201 },
      { level: "error", requestId: "original_request", status: 503 },
    ])
    expect(recordMetric.mock.calls.map((call) => call[0].status)).toEqual([
      201, 503,
    ])
    await provider.shutdown()
  })

  it("preserves request identity through real SDK child spans and sibling errors", async () => {
    const writes = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined)
    const completion = vi.fn()
    const processor = new StorefrontHttpCompletionProcessor({
      write: completion,
      recordMetric: vi.fn(),
    })
    const provider = new BasicTracerProvider({ spanProcessors: [processor] })
    const tracer = provider.getTracer("completion-regression")
    const startRequest = (parentId: string, requestId: string) => {
      registerRequestCompletion({
        traceId: TRACE_THREE,
        spanId: parentId,
        requestId,
        traceFlags: "01",
        traceparent: `00-${TRACE_THREE}-${parentId}-01`,
      })
      const root = tracer.startSpan(
        "request",
        {
          attributes: {
            "next.span_type": "BaseServer.handleRequest",
            "http.status_code": 200,
          },
        },
        trace.setSpanContext(ROOT_CONTEXT, spanContext(TRACE_THREE, parentId))
      )
      const child = tracer.startSpan(
        "handler",
        {},
        trace.setSpan(ROOT_CONTEXT, root)
      )
      const grandchild = tracer.startSpan(
        "fetch",
        {},
        trace.setSpan(ROOT_CONTEXT, child)
      )
      return { root, child, grandchild }
    }
    const first = startRequest(PARENT_ID, "sdk_first")
    const second = startRequest(SECOND_PARENT_ID, "sdk_second")
    const active = vi.spyOn(trace, "getActiveSpan")
    active.mockReturnValue(first.grandchild)
    expect(getActiveTraceContext()).toEqual({
      traceId: TRACE_THREE,
      traceFlags: "01",
    })
    logStorefrontRequestError({
      method: "GET",
      routeType: "render",
      digest: "safe_digest",
    })
    active.mockReturnValue(second.child)
    logStorefrontRequestError({
      method: "GET",
      routeType: "route",
      digest: "private@example.com",
    })
    const errors = writes.mock.calls.map(
      (call) => JSON.parse(String(call[0])) as Record<string, unknown>
    )
    expect(errors.map((event) => event.request_id)).toEqual([
      "sdk_first",
      "sdk_second",
    ])
    expect(errors[0]).toMatchObject({
      trace_id: TRACE_THREE,
      error_digest: "safe_digest",
    })
    expect(errors[1]).not.toHaveProperty("error_digest")
    second.grandchild.end()
    second.child.end()
    second.root.end()
    first.grandchild.end()
    first.child.end()
    first.root.end()
    expect(completion.mock.calls.map((call) => call[1].request_id)).toEqual([
      "sdk_second",
      "sdk_first",
    ])
    logStorefrontRequestError({ method: "GET", routeType: "route" })
    expect(
      JSON.parse(String(writes.mock.calls.at(-1)?.[0]))
    ).not.toHaveProperty("request_id")
    const uncorrelated = tracer.startSpan("uncorrelated", {}, ROOT_CONTEXT)
    active.mockReturnValue(uncorrelated)
    logStorefrontRequestError({ method: "GET", routeType: "route" })
    expect(
      JSON.parse(String(writes.mock.calls.at(-1)?.[0]))
    ).not.toHaveProperty("request_id")
    uncorrelated.end()
    active.mockReturnValue(undefined)
    expect(getActiveTraceContext()).toBeUndefined()
    logStorefrontRequestError({ method: "GET", routeType: "route" })
    expect(
      JSON.parse(String(writes.mock.calls.at(-1)?.[0]))
    ).not.toHaveProperty("trace_id")
    await processor.forceFlush()
    await provider.shutdown()
  })
})
