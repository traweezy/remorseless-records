// @vitest-environment node

import {
  context,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  trace,
  type TextMapGetter,
  type TextMapSetter,
} from "@opentelemetry/api"
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base"
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const PROVIDER_SYMBOL = Symbol.for(
  "com.remorselessrecords.storefront.observability-provider.v1"
)
const providerGlobal = globalThis as typeof globalThis & {
  [key: symbol]: unknown
}
const TRACE_ID = "1234567890abcdef1234567890abcdef"
const PARENT_SPAN_ID = "1111111111111111"
const ended: ReadableSpan[] = []
let registerStorefrontObservability: () => void

const getter: TextMapGetter<Record<string, string>> = {
  keys: (carrier) => Object.keys(carrier),
  get: (carrier, key) => carrier[key],
}
const setter: TextMapSetter<Record<string, string>> = {
  set: (carrier, key, value) => {
    carrier[key] = value
  },
}

const getProvider = (): NodeTracerProvider => {
  const provider = providerGlobal[PROVIDER_SYMBOL]
  if (!(provider instanceof NodeTracerProvider)) {
    throw new Error("Expected the registered Node tracer provider")
  }
  return provider
}

const remoteContext = (traceFlags = 1) =>
  trace.setSpanContext(ROOT_CONTEXT, {
    traceId: TRACE_ID,
    spanId: PARENT_SPAN_ID,
    traceFlags,
    isRemote: true,
  })

beforeEach(async () => {
  vi.resetModules()
  ended.length = 0
  for (const name of [
    "OTEL_SDK_DISABLED",
    "OTEL_SERVICE_NAME",
    "OTEL_RESOURCE_ATTRIBUTES",
    "OTEL_PROPAGATORS",
  ]) {
    vi.stubEnv(name, "")
  }
  const { StorefrontHttpCompletionProcessor } = await import(
    "./request-completion"
  )
  // Capture actual provider callbacks without printing completion logs. The
  // provider and its span lifecycle are real, not replaced by a bootstrap mock.
  vi.spyOn(
    StorefrontHttpCompletionProcessor.prototype,
    "onEnd"
  ).mockImplementation((span) => {
    ended.push(span)
  })
  const bootstrap = await import("./register")
  registerStorefrontObservability = bootstrap.registerStorefrontObservability
})

afterEach(async () => {
  const provider = providerGlobal[PROVIDER_SYMBOL]
  if (provider instanceof NodeTracerProvider) {
    await provider.shutdown()
  }
  delete providerGlobal[PROVIDER_SYMBOL]
  trace.disable()
  context.disable()
  propagation.disable()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe("Storefront OpenTelemetry registration", () => {
  it("uses the standard provider and default Storefront SDK resource", () => {
    const originalFetch = globalThis.fetch
    registerStorefrontObservability()
    expect(getProvider()).toBeInstanceOf(NodeTracerProvider)
    const span = trace.getTracer("bootstrap-fixture").startSpan("request")
    expect(span.isRecording()).toBe(true)
    span.end()

    expect(ended).toHaveLength(1)
    expect(ended[0]?.resource.attributes).toMatchObject({
      "service.name": "storefront",
      "telemetry.sdk.language": "nodejs",
      "telemetry.sdk.name": "opentelemetry",
    })
    expect(globalThis.fetch).toBe(originalFetch)
  })

  it("registers once across repeated calls and reloaded module copies", async () => {
    registerStorefrontObservability()
    const provider = getProvider()
    registerStorefrontObservability()
    vi.resetModules()
    const reloaded = await import("./register")
    reloaded.registerStorefrontObservability()

    expect(getProvider()).toBe(provider)
    trace.getTracer("bootstrap-fixture").startSpan("request").end()
    expect(ended).toHaveLength(1)
  })

  it.each(["true", " TRUE "])("disables the SDK for %j", (value) => {
    vi.stubEnv("OTEL_SDK_DISABLED", value)
    registerStorefrontObservability()

    expect(providerGlobal[PROVIDER_SYMBOL]).toBeUndefined()
    expect(
      trace.getTracer("bootstrap-fixture").startSpan("request").isRecording()
    ).toBe(false)
    expect(ended).toHaveLength(0)
  })

  it.each([undefined, "false"])("keeps SDK flag %j enabled", (value) => {
    vi.stubEnv("OTEL_SDK_DISABLED", value)
    registerStorefrontObservability()
    const span = trace.getTracer("bootstrap-fixture").startSpan("request")
    expect(span.isRecording()).toBe(true)
    span.end()
    expect(ended).toHaveLength(1)
  })

  it("does not mark a disabled bootstrap as already registered", () => {
    vi.stubEnv("OTEL_SDK_DISABLED", "true")
    registerStorefrontObservability()
    vi.stubEnv("OTEL_SDK_DISABLED", "false")
    registerStorefrontObservability()
    expect(getProvider()).toBeInstanceOf(NodeTracerProvider)
  })

  it("lets service-name environment override resource attributes", () => {
    vi.stubEnv("OTEL_SERVICE_NAME", "storefront-fixture")
    vi.stubEnv(
      "OTEL_RESOURCE_ATTRIBUTES",
      "service.name=resource-fixture,deployment.environment.name=fixture,fixture.label=hello%20world"
    )
    registerStorefrontObservability()
    trace.getTracer("bootstrap-fixture").startSpan("request").end()
    expect(ended[0]?.resource.attributes).toMatchObject({
      "service.name": "storefront-fixture",
      "deployment.environment.name": "fixture",
      "fixture.label": "hello world",
    })
  })

  it("lets resource attributes override the default service name", () => {
    vi.stubEnv("OTEL_RESOURCE_ATTRIBUTES", "service.name=resource-fixture")
    registerStorefrontObservability()
    trace.getTracer("bootstrap-fixture").startSpan("request").end()
    expect(ended[0]?.resource.attributes["service.name"]).toBe(
      "resource-fixture"
    )
  })

  it.each([0, 1])(
    "propagates W3C context and baggage with trace flags %i",
    async (traceFlags) => {
      registerStorefrontObservability()
      const incoming = {
        traceparent: `00-${TRACE_ID}-${PARENT_SPAN_ID}-0${traceFlags}`,
        baggage: "fixture.label=hello%20world",
      }
      const extracted = propagation.extract(ROOT_CONTEXT, incoming, getter)
      expect(trace.getSpanContext(extracted)).toMatchObject({
        traceId: TRACE_ID,
        spanId: PARENT_SPAN_ID,
        traceFlags,
        isRemote: true,
      })
      expect(
        propagation.getBaggage(extracted)?.getEntry("fixture.label")?.value
      ).toBe("hello world")
      await context.with(extracted, async () => {
        await Promise.resolve()
        expect(trace.getSpanContext(context.active())?.spanId).toBe(
          PARENT_SPAN_ID
        )
        const carrier: Record<string, string> = {}
        propagation.inject(context.active(), carrier, setter)
        expect(carrier).toEqual(incoming)
      })
      expect(trace.getSpanContext(context.active())).toBeUndefined()
    }
  )

  it("preserves parent-based always-on sampling", () => {
    registerStorefrontObservability()
    const tracer = trace.getTracer("bootstrap-fixture")
    const root = tracer.startSpan("root", {}, ROOT_CONTEXT)
    const sampled = tracer.startSpan("sampled", {}, remoteContext())
    const unsampled = tracer.startSpan("unsampled", {}, remoteContext(0))
    expect(root.isRecording()).toBe(true)
    expect(sampled.isRecording()).toBe(true)
    expect(unsampled.isRecording()).toBe(false)
    root.end()
    sampled.end()
    unsampled.end()
    expect(ended.map((span) => span.name)).toEqual(["root", "sampled"])
  })

  it.each([
    { value: undefined, includesTrace: true, includesBaggage: true },
    { value: "", includesTrace: true, includesBaggage: true },
    { value: " , ", includesTrace: true, includesBaggage: true },
    { value: "auto", includesTrace: true, includesBaggage: true },
    { value: "none", includesTrace: false, includesBaggage: false },
    { value: "tracecontext", includesTrace: true, includesBaggage: false },
    { value: "baggage", includesTrace: false, includesBaggage: true },
    {
      value: "none, tracecontext, none",
      includesTrace: true,
      includesBaggage: false,
    },
    {
      value: "none, baggage, none",
      includesTrace: false,
      includesBaggage: true,
    },
    {
      value: "baggage, tracecontext, baggage",
      includesTrace: true,
      includesBaggage: true,
    },
    {
      value: "auto, tracecontext, baggage, auto",
      includesTrace: true,
      includesBaggage: true,
    },
  ])(
    "honors and deduplicates propagator selection $value",
    ({ value, includesTrace, includesBaggage }) => {
      vi.stubEnv("OTEL_PROPAGATORS", value)
      registerStorefrontObservability()
      const incoming = {
        traceparent: `00-${TRACE_ID}-${PARENT_SPAN_ID}-01`,
        baggage: "fixture.label=hello%20world",
      }
      const extracted = propagation.extract(ROOT_CONTEXT, incoming, getter)
      expect(trace.getSpanContext(extracted)?.traceId).toBe(
        includesTrace ? TRACE_ID : undefined
      )
      expect(
        propagation.getBaggage(extracted)?.getEntry("fixture.label")?.value
      ).toBe(includesBaggage ? "hello world" : undefined)

      // Start from a complete context independently of extraction, so a
      // disabled propagator must suppress outbound data as well as inbound data.
      const outgoing = propagation.setBaggage(
        remoteContext(),
        propagation.createBaggage({ "fixture.label": { value: "hello world" } })
      )
      const carrier: Record<string, string> = {}
      const set = vi.fn(setter.set)
      propagation.inject(outgoing, carrier, { set })
      expect(carrier).toEqual({
        ...(includesTrace ? { traceparent: incoming.traceparent } : {}),
        ...(includesBaggage ? { baggage: incoming.baggage } : {}),
      })
      expect(set).toHaveBeenCalledTimes(
        Number(includesTrace) + Number(includesBaggage)
      )
    }
  )

  it.each([
    "fixture-private-value",
    "tracecontext,fixture-private-value",
    "NONE",
    "jaeger",
  ])(
    "rejects unsupported propagator configuration %j before registration",
    (value) => {
      vi.stubEnv("OTEL_PROPAGATORS", value)
      const registration = vi.spyOn(NodeTracerProvider.prototype, "register")
      expect(registerStorefrontObservability).toThrow(
        new Error("Unsupported OpenTelemetry propagator configuration")
      )
      expect(registration).not.toHaveBeenCalled()
      expect(providerGlobal[PROVIDER_SYMBOL]).toBeUndefined()
      expect(
        trace.getTracer("bootstrap-fixture").startSpan("request").isRecording()
      ).toBe(false)
      expect(ended).toHaveLength(0)
    }
  )

  it("does not end sibling request roots when the first shared-trace request ends", async () => {
    registerStorefrontObservability()
    const tracer = trace.getTracer("bootstrap-fixture")
    const spans = Array.from({ length: 4 }, (_, index) =>
      tracer.startSpan(
        `request-${index}`,
        {
          kind: SpanKind.SERVER,
          attributes: {
            "next.span_type": "BaseServer.handleRequest",
            "http.method": "GET",
          },
        },
        remoteContext()
      )
    )
    const statuses = [200, 503, 204, 400]
    for (const [index, span] of spans.entries()) {
      expect(span.isRecording()).toBe(true)
      span.setAttribute("http.status_code", statuses[index] ?? 0)
      span.end()
      await getProvider().forceFlush()

      expect(ended).toHaveLength(index + 1)
      expect(
        spans.slice(index + 1).every((sibling) => sibling.isRecording())
      ).toBe(true)
    }
    expect(ended.map((span) => span.attributes["http.status_code"])).toEqual(
      statuses
    )
    expect(new Set(ended.map((span) => span.spanContext().spanId)).size).toBe(4)
    expect(ended.every((span) => span.spanContext().traceId === TRACE_ID)).toBe(
      true
    )
  })
})
