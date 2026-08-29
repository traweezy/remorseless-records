export type RequestCorrelation = {
  requestId: string
  traceId: string
  spanId: string
  traceFlags: string
  traceparent: string
}

type ActiveTraceContext = {
  traceFlags: string
  traceId: string
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const TRACEPARENT_PATTERN =
  /^(?<version>[0-9a-f]{2})-(?<traceId>[0-9a-f]{32})-(?<parentId>[0-9a-f]{16})-(?<traceFlags>[0-9a-f]{2})$/u
const ZERO_TRACE_ID = "0".repeat(32)
const ZERO_SPAN_ID = "0".repeat(16)
const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/u
const TRACE_FLAGS_PATTERN = /^[0-9a-f]{2}$/u
const requestCorrelations = new WeakMap<Request, RequestCorrelation>()

const randomHex = (bytes: number): string => {
  const value = new Uint8Array(bytes)
  globalThis.crypto.getRandomValues(value)
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  )
}

const acceptedRequestId = (value: string | null): string | undefined => {
  const candidate = value?.trim()
  return candidate && REQUEST_ID_PATTERN.test(candidate) ? candidate : undefined
}

const acceptedTraceparent = (
  value: string | null
): { traceId: string; traceFlags: string } | undefined => {
  const candidate = value?.trim().toLowerCase()
  if (!candidate) {
    return undefined
  }

  const match = TRACEPARENT_PATTERN.exec(candidate)
  const version = match?.groups?.version
  const traceId = match?.groups?.traceId
  const parentId = match?.groups?.parentId
  const traceFlags = match?.groups?.traceFlags
  if (
    !version ||
    !traceId ||
    !parentId ||
    !traceFlags ||
    version === "ff" ||
    traceId === ZERO_TRACE_ID ||
    parentId === ZERO_SPAN_ID
  ) {
    return undefined
  }

  return {
    traceId,
    traceFlags,
  }
}

export const createRequestCorrelation = (
  headers: Headers,
  activeTrace?: ActiveTraceContext
): RequestCorrelation => {
  const incomingTrace = acceptedTraceparent(headers.get("traceparent"))
  const validActiveTrace =
    activeTrace &&
    TRACE_ID_PATTERN.test(activeTrace.traceId) &&
    activeTrace.traceId !== ZERO_TRACE_ID &&
    TRACE_FLAGS_PATTERN.test(activeTrace.traceFlags)
      ? activeTrace
      : undefined
  const traceId =
    incomingTrace?.traceId ?? validActiveTrace?.traceId ?? randomHex(16)
  const spanId = randomHex(8)
  const traceFlags =
    incomingTrace?.traceFlags ?? validActiveTrace?.traceFlags ?? "01"

  return {
    requestId:
      acceptedRequestId(headers.get("x-request-id")) ?? crypto.randomUUID(),
    traceId,
    spanId,
    traceFlags,
    traceparent: `00-${traceId}-${spanId}-${traceFlags}`,
  }
}

export const getRequestCorrelation = (request: Request): RequestCorrelation => {
  const existing = requestCorrelations.get(request)
  if (existing) {
    return existing
  }

  const correlation = createRequestCorrelation(request.headers)
  requestCorrelations.set(request, correlation)
  return correlation
}

export const applyCorrelationToRequestHeaders = (
  headers: Headers,
  correlation: RequestCorrelation
): void => {
  headers.set("x-request-id", correlation.requestId)
  headers.set("traceparent", correlation.traceparent)
}

export const applyCorrelationToResponse = <T extends Response>(
  response: T,
  correlation: RequestCorrelation
): T => {
  response.headers.set("X-Request-Id", correlation.requestId)
  response.headers.set("traceparent", correlation.traceparent)
  return response
}

export const createUpstreamHeaders = (
  request: Request,
  initial?: HeadersInit
): Headers => {
  const correlation = getRequestCorrelation(request)
  const headers = new Headers(initial)
  const spanId = randomHex(8)
  headers.set("x-request-id", correlation.requestId)
  headers.set(
    "traceparent",
    `00-${correlation.traceId}-${spanId}-${correlation.traceFlags}`
  )
  return headers
}
