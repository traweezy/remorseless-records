import "server-only"

import {
  isSpanContextValid,
  trace,
  type Context,
  type Span,
} from "@opentelemetry/api"
import type {
  ReadableSpan,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base"

import type { RequestCorrelation } from "@/lib/http/correlation"

import { getStorefrontRuntimeIdentity } from "./runtime-identity"
import { recordStorefrontHttpMetric } from "./metrics"

type RegisteredRequest = {
  expiresAt: number
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
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const REGISTRY_SYMBOL = Symbol.for(
  "com.remorselessrecords.storefront.request-completion-registry"
)

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

  register(traceId: string, requestId: string): void {
    if (
      !TRACE_ID_PATTERN.test(traceId) ||
      !REQUEST_ID_PATTERN.test(requestId)
    ) {
      return
    }

    const now = this.#now()
    this.#pruneExpired(now)
    this.#requests.delete(traceId)
    while (this.#requests.size >= this.#maxEntries) {
      const oldestTraceId = this.#requests.keys().next().value
      if (!oldestTraceId) {
        break
      }
      this.#requests.delete(oldestTraceId)
    }
    this.#requests.set(traceId, {
      expiresAt: now + this.#ttlMs,
      requestId,
    })
  }

  lookup(traceId: string): string | undefined {
    const registered = this.#requests.get(traceId)
    if (!registered) {
      return undefined
    }
    if (registered.expiresAt <= this.#now()) {
      this.#requests.delete(traceId)
      return undefined
    }
    return registered.requestId
  }

  consume(traceId: string): string | undefined {
    const requestId = this.lookup(traceId)
    this.#requests.delete(traceId)
    return requestId
  }

  #pruneExpired(now: number): void {
    for (const [traceId, registered] of this.#requests) {
      if (registered.expiresAt > now) {
        continue
      }
      this.#requests.delete(traceId)
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
  requestRegistry.register(correlation.traceId, correlation.requestId)
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
  write?: CompletionLogWriter
}

export class StorefrontHttpCompletionProcessor implements SpanProcessor {
  readonly #registry: BoundedRequestRegistry
  readonly #recordMetric: typeof recordStorefrontHttpMetric
  readonly #write: CompletionLogWriter

  constructor(options: ProcessorOptions = {}) {
    this.#registry = options.registry ?? requestRegistry
    this.#recordMetric = options.recordMetric ?? recordStorefrontHttpMetric
    this.#write = options.write ?? defaultWrite
  }

  onStart(_span: Span, _parentContext: Context): void {}

  onEnd(span: ReadableSpan): void {
    if (span.attributes["next.span_type"] !== NEXT_ROOT_SPAN_TYPE) {
      return
    }
    if (!stringAttribute(span.attributes["next.route"])) {
      return
    }

    const spanContext = span.spanContext()
    const requestId = this.#registry.consume(spanContext.traceId)
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
  const traceId = hasValidSpan ? spanContext?.traceId : undefined
  const requestId = traceId ? requestRegistry.lookup(traceId) : undefined
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
