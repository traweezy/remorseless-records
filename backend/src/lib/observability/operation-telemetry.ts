import {
  SpanStatusCode,
  context,
  metrics,
  trace,
  type Attributes,
  type Span,
} from "@opentelemetry/api"

type OperationByDomain = {
  database: "health_check" | "query"
  email: "send"
  http: "request"
  queue: "publish" | "process"
  redis: "command" | "health_check"
  scheduled_job: "run"
  search: "health_check" | "request"
  storage: "health_check" | "request"
  stripe: "provider_request" | "webhook"
  tax: "calculate" | "provider_request"
}

export type OperationDomain = keyof OperationByDomain
export type ObservedOperation = {
  [Domain in OperationDomain]: {
    domain: Domain
    operation: OperationByDomain[Domain]
  }
}[OperationDomain]

export type OperationResult = "error" | "ok"

const meter = metrics.getMeter("remorseless-records.backend.operations")
const tracer = trace.getTracer("remorseless-records.backend.operations")
const operationCalls = meter.createCounter("rr.operation.calls", {
  description: "Count of bounded backend operations by domain and result",
  unit: "{operation}",
})
const operationDuration = meter.createHistogram("rr.operation.duration", {
  description: "Duration of bounded backend operations",
  unit: "ms",
})

const safeDuration = (durationMs: number): number =>
  Number.isFinite(durationMs) && durationMs >= 0
    ? Number(durationMs.toFixed(3))
    : 0

export const operationMetricAttributes = (
  input: ObservedOperation,
  result: OperationResult
): Attributes => ({
  "rr.domain": input.domain,
  "rr.operation": input.operation,
  "rr.result": result,
  "service.name": "backend",
})

const recordOperationMetrics = (
  input: ObservedOperation,
  result: OperationResult,
  durationMs: number
): void => {
  const attributes = operationMetricAttributes(input, result)
  operationCalls.add(1, attributes)
  operationDuration.record(safeDuration(durationMs), attributes)
}

export const recordOperationResult = (
  input: ObservedOperation,
  result: OperationResult,
  durationMs: number
): void => {
  const boundedDuration = safeDuration(durationMs)
  const span = tracer.startSpan(`rr.${input.domain}.${input.operation}`, {
    attributes: operationMetricAttributes(input, result),
    startTime: Date.now() - boundedDuration,
  })
  span.setAttribute("rr.duration_ms", boundedDuration)
  span.setStatus(
    result === "ok"
      ? { code: SpanStatusCode.OK }
      : { code: SpanStatusCode.ERROR, message: "operation_failed" }
  )
  recordOperationMetrics(input, result, boundedDuration)
  span.end()
}

const finishSpan = (
  span: Span,
  input: ObservedOperation,
  result: OperationResult,
  durationMs: number
): void => {
  span.setAttribute("rr.result", result)
  span.setAttribute("rr.duration_ms", safeDuration(durationMs))
  span.setStatus(
    result === "ok"
      ? { code: SpanStatusCode.OK }
      : { code: SpanStatusCode.ERROR, message: "operation_failed" }
  )
  recordOperationMetrics(input, result, durationMs)
  span.end()
}

export const observeOperation = async <Result>(
  input: ObservedOperation,
  operation: () => Promise<Result>
): Promise<Result> => {
  const span = tracer.startSpan(`rr.${input.domain}.${input.operation}`, {
    attributes: operationMetricAttributes(input, "ok"),
  })
  const startedAt = performance.now()

  return context.with(trace.setSpan(context.active(), span), async () => {
    try {
      const result = await operation()
      finishSpan(span, input, "ok", performance.now() - startedAt)
      return result
    } catch (error: unknown) {
      finishSpan(span, input, "error", performance.now() - startedAt)
      throw error
    }
  })
}
