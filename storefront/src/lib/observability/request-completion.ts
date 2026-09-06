import "server-only"

import { isSpanContextValid, trace, type Context } from "@opentelemetry/api"
import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base"

import type { RequestCorrelation } from "@/lib/http/correlation"

import { getStorefrontRuntimeIdentity } from "./runtime-identity"
import { recordStorefrontHttpMetric } from "./metrics"

type RegisteredRequest = {
  expiresAt: number
  ownerSpanId?: string
  requestId: string
}

type RequestRegistryOptions = {
  maxEntries?: number
  now?: () => number
  requests?: Map<string, RegisteredRequest>
  ttlMs?: number
}

type CompletionLogLevel = "error" | "info"

type CompletionLogWriter = (
  level: CompletionLogLevel,
  event: Readonly<Record<string, unknown>>
) => void

const DEFAULT_MAX_ENTRIES = 10_000
const DEFAULT_TTL_MS = 5 * 60_000
const NEXT_ROOT_SPAN_TYPE = "BaseServer.handleRequest"
const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/u
const SPAN_ID_PATTERN = /^[0-9a-f]{16}$/u
const ZERO_TRACE_ID = "0".repeat(32)
const ZERO_SPAN_ID = "0".repeat(16)
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const REGISTRY_SYMBOL = Symbol.for(
  "com.remorselessrecords.storefront.request-completion-registry.v2"
)
const SPAN_REGISTRY_SYMBOL = Symbol.for(
  "com.remorselessrecords.storefront.request-completion-spans.v2"
)

type RequestSpanKey = { traceId: string; spanId: string }

export class BoundedRequestRegistry {
  readonly #maxEntries: number
  readonly #now: () => number
  readonly #requests: Map<string, RegisteredRequest>
  readonly #ttlMs: number

  constructor(options: RequestRegistryOptions = {}) {
    this.#maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.#now = options.now ?? Date.now
    this.#requests = options.requests ?? new Map<string, RegisteredRequest>()
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS

    if (!Number.isSafeInteger(this.#maxEntries) || this.#maxEntries < 1) {
      throw new RangeError("Request registry maxEntries must be positive")
    }
    if (!Number.isSafeInteger(this.#ttlMs) || this.#ttlMs < 1) {
      throw new RangeError("Request registry ttlMs must be positive")
    }
  }

  get size(): number {
    return this.#requests.size
  }

  register(traceId: string, spanId: string, requestId: string): void {
    if (
      !TRACE_ID_PATTERN.test(traceId) ||
      traceId === ZERO_TRACE_ID ||
      !SPAN_ID_PATTERN.test(spanId) ||
      spanId === ZERO_SPAN_ID ||
      !REQUEST_ID_PATTERN.test(requestId)
    ) {
      return
    }

    const now = this.#now()
    const key = `${traceId}:${spanId}`
    this.#pruneExpired(now)
    this.#requests.delete(key)
    while (this.#requests.size >= this.#maxEntries) {
      const oldestKey = this.#requests.keys().next().value
      if (!oldestKey) {
        break
      }
      this.#requests.delete(oldestKey)
    }
    this.#requests.set(key, {
      expiresAt: now + this.#ttlMs,
      requestId,
    })
  }

  lookup(traceId: string, spanId: string): string | undefined {
    const key = `${traceId}:${spanId}`
    const registered = this.#requests.get(key)
    if (!registered) {
      return undefined
    }
    if (registered.expiresAt <= this.#now()) {
      this.#requests.delete(key)
      return undefined
    }
    return registered.requestId
  }

  claim(traceId: string, spanId: string, ownerSpanId: string): boolean {
    if (
      !SPAN_ID_PATTERN.test(ownerSpanId) ||
      ownerSpanId === ZERO_SPAN_ID ||
      !this.lookup(traceId, spanId)
    ) {
      return false
    }
    const key = `${traceId}:${spanId}`
    const registered = this.#requests.get(key)
    if (
      !registered ||
      (registered.ownerSpanId && registered.ownerSpanId !== ownerSpanId)
    ) {
      return false
    }
    this.#requests.set(key, { ...registered, ownerSpanId })
    return true
  }

  consume(
    traceId: string,
    spanId: string,
    ownerSpanId: string
  ): string | undefined {
    const requestId = this.lookup(traceId, spanId)
    const key = `${traceId}:${spanId}`
    if (!ownerSpanId || this.#requests.get(key)?.ownerSpanId !== ownerSpanId) {
      return undefined
    }
    this.#requests.delete(key)
    return requestId
  }

  #pruneExpired(now: number): void {
    for (const [key, registered] of this.#requests) {
      if (registered.expiresAt > now) {
        continue
      }
      this.#requests.delete(key)
    }
  }
}

type SymbolRegistry = {
  [key: symbol]: unknown
}

const registryGlobal = globalThis as typeof globalThis & SymbolRegistry
const existingRequests = registryGlobal[REGISTRY_SYMBOL]
const sharedRequests =
  existingRequests instanceof Map
    ? (existingRequests as Map<string, RegisteredRequest>)
    : new Map<string, RegisteredRequest>()
registryGlobal[REGISTRY_SYMBOL] = sharedRequests
const requestRegistry = new BoundedRequestRegistry({ requests: sharedRequests })
const existingSpans = registryGlobal[SPAN_REGISTRY_SYMBOL]
const requestSpans =
  existingSpans instanceof WeakMap
    ? (existingSpans as WeakMap<object, RequestSpanKey>)
    : new WeakMap<object, RequestSpanKey>()
registryGlobal[SPAN_REGISTRY_SYMBOL] = requestSpans

export const getActiveTraceContext = ():
  | { traceFlags: string; traceId: string }
  | undefined => {
  const spanContext = trace.getActiveSpan()?.spanContext()
  if (!spanContext || !isSpanContextValid(spanContext)) {
    return undefined
  }

  return {
    traceFlags: spanContext.traceFlags.toString(16).padStart(2, "0"),
    traceId: spanContext.traceId,
  }
}

export const registerRequestCompletion = (
  correlation: RequestCorrelation
): void => {
  requestRegistry.register(
    correlation.traceId,
    correlation.spanId,
    correlation.requestId
  )
  const activeSpan = trace.getActiveSpan()
  if (activeSpan?.spanContext().traceId === correlation.traceId) {
    requestSpans.set(activeSpan, {
      traceId: correlation.traceId,
      spanId: correlation.spanId,
    })
  }
}

const deploymentIdentity = getStorefrontRuntimeIdentity()

const defaultWrite: CompletionLogWriter = (level, event) => {
  const line = JSON.stringify(event)
  if (level === "error") {
    console.error(line)
    return
  }
  console.log(line)
}

const numericAttribute = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined

const stringAttribute = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined

const durationMilliseconds = (span: ReadableSpan): number =>
  Number((span.duration[0] * 1_000 + span.duration[1] / 1_000_000).toFixed(3))

type ProcessorOptions = {
  recordMetric?: typeof recordStorefrontHttpMetric
  registry?: BoundedRequestRegistry
  spans?: WeakMap<object, RequestSpanKey>
  write?: CompletionLogWriter
}

export class StorefrontHttpCompletionProcessor implements SpanProcessor {
  readonly #registry: BoundedRequestRegistry
  readonly #recordMetric: typeof recordStorefrontHttpMetric
  readonly #write: CompletionLogWriter
  readonly #spans: WeakMap<object, RequestSpanKey>

  constructor(options: ProcessorOptions = {}) {
    this.#registry = options.registry ?? requestRegistry
    this.#recordMetric = options.recordMetric ?? recordStorefrontHttpMetric
    this.#write = options.write ?? defaultWrite
    this.#spans = options.spans ?? requestSpans
  }

  onStart(span: Span, parentContext: Context): void {
    const parent = trace.getSpan(parentContext)
    if (!parent) {
      return
    }
    const parentKey = parent.spanContext()
    const spanContext = span.spanContext()
    if (
      !isSpanContextValid(parentKey) ||
      !isSpanContextValid(spanContext) ||
      parentKey.traceId !== spanContext.traceId
    ) {
      return
    }
    if (span.attributes["next.span_type"] === NEXT_ROOT_SPAN_TYPE) {
      // The route root starts before its forwarded parent can be returned to
      // a client. A later pre-proxy root can replay that parent, but cannot
      // claim its completion or inherit its request's error correlation.
      if (
        this.#registry.claim(
          parentKey.traceId,
          parentKey.spanId,
          spanContext.spanId
        )
      ) {
        this.#spans.set(span, {
          traceId: parentKey.traceId,
          spanId: parentKey.spanId,
        })
      }
      return
    }
    const key = this.#spans.get(parent)
    if (
      key?.traceId === spanContext.traceId &&
      this.#registry.lookup(key.traceId, key.spanId)
    ) {
      this.#spans.set(span, { traceId: key.traceId, spanId: key.spanId })
    }
  }

  onEnd(span: ReadableSpan): void {
    if (span.attributes["next.span_type"] !== NEXT_ROOT_SPAN_TYPE) {
      return
    }
    // The proxy creates a unique outgoing parent for the route's root span.
    // Trace IDs are shared by sibling requests; Next also emits a pre-proxy
    // root and can omit next.route, so neither a trace nor route is an identity.
    const parent = span.parentSpanContext
    if (!parent || !isSpanContextValid(parent)) {
      return
    }

    const spanContext = span.spanContext()
    if (
      !isSpanContextValid(spanContext) ||
      parent.traceId !== spanContext.traceId
    ) {
      return
    }
    const requestId = this.#registry.consume(
      parent.traceId,
      parent.spanId,
      spanContext.spanId
    )
    if (!requestId) {
      return
    }

    const status =
      numericAttribute(span.attributes["http.response.status_code"]) ??
      numericAttribute(span.attributes["http.status_code"]) ??
      0
    const method =
      stringAttribute(span.attributes["http.request.method"]) ??
      stringAttribute(span.attributes["http.method"]) ??
      "UNKNOWN"

    const durationMs = durationMilliseconds(span)
    this.#recordMetric({ durationMs, method, status })
    this.#write(status >= 500 || status === 0 ? "error" : "info", {
      ...deploymentIdentity,
      duration_ms: durationMs,
      event: "http.request.completed",
      message: "Storefront request completed",
      method,
      request_id: requestId,
      span_id: spanContext.spanId,
      status,
      trace_id: spanContext.traceId,
    })
  }

  forceFlush(): Promise<void> {
    return Promise.resolve()
  }

  shutdown(): Promise<void> {
    return Promise.resolve()
  }
}

type RequestErrorInput = {
  digest?: string
  method: string
  routeType: string
}

export const logStorefrontRequestError = (input: RequestErrorInput): void => {
  const activeSpan = trace.getActiveSpan()
  const spanContext = activeSpan?.spanContext()
  const hasValidSpan = Boolean(spanContext && isSpanContextValid(spanContext))
  const requestKey = activeSpan ? requestSpans.get(activeSpan) : undefined
  const requestId =
    hasValidSpan && requestKey && requestKey.traceId === spanContext?.traceId
      ? requestRegistry.lookup(requestKey.traceId, requestKey.spanId)
      : undefined
  const digest =
    input.digest && /^[A-Za-z0-9_-]{1,128}$/u.test(input.digest)
      ? input.digest
      : undefined

  defaultWrite("error", {
    ...deploymentIdentity,
    event: "http.request.error",
    message: "Storefront request failed",
    method: input.method,
    route_type: input.routeType,
    ...(digest ? { error_digest: digest } : {}),
    ...(requestId ? { request_id: requestId } : {}),
    ...(spanContext && hasValidSpan
      ? { span_id: spanContext.spanId, trace_id: spanContext.traceId }
      : {}),
  })
}
