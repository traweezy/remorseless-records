export const DEFAULT_PROVIDER_TIMEOUT_MS = 8_000
export const DEFAULT_PROVIDER_READ_ATTEMPTS = 2
export const DEFAULT_PROVIDER_RETRY_BASE_DELAY_MS = 100
export const MAX_PROVIDER_RETRY_DELAY_MS = 1_000

const retryableReadStatuses = new Set([408, 425, 429, 500, 502, 503, 504])

export const isRetryableProviderReadStatus = (status: number): boolean =>
  retryableReadStatuses.has(status)

export type ProviderFailureKind = "timeout" | "unavailable"

export class ProviderRequestError extends Error {
  readonly kind: ProviderFailureKind
  readonly callerAborted: boolean

  constructor(
    kind: ProviderFailureKind,
    { callerAborted = false }: { callerAborted?: boolean } = {}
  ) {
    super(
      kind === "timeout"
        ? "The upstream provider request timed out"
        : "The upstream provider request failed"
    )
    this.name = "ProviderRequestError"
    this.kind = kind
    this.callerAborted = callerAborted
  }
}

const isAbortLikeError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false
  }

  const name = (error as { name?: unknown }).name
  return name === "AbortError" || name === "TimeoutError"
}

export const toProviderRequestError = (error: unknown): ProviderRequestError =>
  error instanceof ProviderRequestError
    ? error
    : new ProviderRequestError(
        isAbortLikeError(error) ? "timeout" : "unavailable"
      )

export const createProviderSignal = (
  signal?: AbortSignal | null,
  timeoutMs: number = DEFAULT_PROVIDER_TIMEOUT_MS
): AbortSignal => {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("Provider timeout must be a positive integer")
  }

  const deadline = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, deadline]) : deadline
}

export type ProviderReadOptions = {
  maxAttempts?: number
  recordMetric?: ProviderMetricRecorder
  retryBaseDelayMs?: number
  timeoutMs?: number
}

export type ProviderReadMetric = {
  durationMs: number
  result: "error" | "ok"
}

export type ProviderMetricRecorder = (metric: ProviderReadMetric) => void

const safelyRecordProviderMetric = (
  recorder: ProviderMetricRecorder | undefined,
  metric: ProviderReadMetric
): void => {
  try {
    recorder?.(metric)
  } catch {
    // Telemetry must never change the provider request outcome.
  }
}

export type ProviderRetryDecision =
  | { retry: false }
  | { response?: Response; retry: true }

export type ProviderRetryEvent = {
  attempt: number
  delayMs: number
  maxAttempts: number
}

export type ProviderReadOperationOptions = ProviderReadOptions & {
  classifyRetry: (error: unknown) => ProviderRetryDecision
  onRetry?: (event: ProviderRetryEvent) => void
  signal?: AbortSignal | null
}

const callerWonAbort = (
  signal: AbortSignal,
  callerSignal: AbortSignal | null | undefined
): boolean =>
  callerSignal?.aborted === true && signal.reason === callerSignal.reason

const readAttempt = async <T>(
  operation: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  callerSignal: AbortSignal | null | undefined
): Promise<T> => {
  if (signal.aborted) {
    throw new ProviderRequestError("timeout", {
      callerAborted: callerWonAbort(signal, callerSignal),
    })
  }

  let onAbort: (() => void) | undefined
  const cancellation = new Promise<never>((_resolve, reject) => {
    onAbort = () =>
      reject(
        new ProviderRequestError("timeout", {
          callerAborted: callerWonAbort(signal, callerSignal),
        })
      )
    signal.addEventListener("abort", onAbort, { once: true })
  })

  try {
    let pending: Promise<T>
    try {
      pending = operation(signal)
    } catch (error) {
      pending = Promise.reject(error)
    }
    return await Promise.race([pending, cancellation])
  } finally {
    if (onAbort) {
      signal.removeEventListener("abort", onAbort)
    }
  }
}

const assertBoundedInteger = (
  value: number,
  name: string,
  maximum: number
): void => {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new RangeError(`${name} must be an integer between 1 and ${maximum}`)
  }
}

const parseRetryAfterMs = (
  value: string | null,
  nowMs: number
): number | undefined => {
  if (value === null) {
    return undefined
  }

  const normalized = value.trim()
  if (/^\d+$/.test(normalized)) {
    const seconds = Number(normalized)
    const milliseconds = seconds * 1_000
    return Number.isSafeInteger(milliseconds)
      ? milliseconds
      : MAX_PROVIDER_RETRY_DELAY_MS + 1
  }

  const dateMs = Date.parse(normalized)
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - nowMs) : undefined
}

const retryDelayMs = (
  response: Response | null,
  attempt: number,
  baseDelayMs: number
): number | null => {
  const backoffMs = Math.min(
    baseDelayMs * 2 ** attempt,
    MAX_PROVIDER_RETRY_DELAY_MS
  )
  const retryAfterMs = response
    ? parseRetryAfterMs(response.headers.get("retry-after"), Date.now())
    : undefined

  if (
    retryAfterMs !== undefined &&
    retryAfterMs > MAX_PROVIDER_RETRY_DELAY_MS
  ) {
    return null
  }
  return Math.max(backoffMs, retryAfterMs ?? 0)
}

const waitForRetry = (
  delayMs: number,
  signal: AbortSignal,
  callerSignal?: AbortSignal | null
): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(
        new ProviderRequestError("timeout", {
          callerAborted: callerWonAbort(signal, callerSignal),
        })
      )
      return
    }

    const onAbort = (): void => {
      clearTimeout(timeout)
      reject(
        new ProviderRequestError("timeout", {
          callerAborted: callerWonAbort(signal, callerSignal),
        })
      )
    }
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, delayMs)
    signal.addEventListener("abort", onAbort, { once: true })
  })

const cancelResponseBody = async (response: Response): Promise<void> => {
  try {
    await response.body?.cancel()
  } catch {
    // The retry remains safe when an already-closed response cannot be canceled.
  }
}

export const runProviderReadOperation = async <T>(
  operation: (signal: AbortSignal) => Promise<T>,
  {
    classifyRetry,
    maxAttempts = DEFAULT_PROVIDER_READ_ATTEMPTS,
    onRetry,
    retryBaseDelayMs = DEFAULT_PROVIDER_RETRY_BASE_DELAY_MS,
    signal: callerSignal,
    timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
  }: ProviderReadOperationOptions
): Promise<T> => {
  assertBoundedInteger(maxAttempts, "Provider read attempts", 3)
  assertBoundedInteger(
    retryBaseDelayMs,
    "Provider retry base delay",
    MAX_PROVIDER_RETRY_DELAY_MS
  )

  const signal = createProviderSignal(callerSignal, timeoutMs)
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (signal.aborted) {
      throw new ProviderRequestError("timeout", {
        callerAborted: callerWonAbort(signal, callerSignal),
      })
    }

    try {
      return await readAttempt(operation, signal, callerSignal)
    } catch (error) {
      const providerError = toProviderRequestError(error)
      if (
        signal.aborted ||
        providerError.kind === "timeout" ||
        attempt + 1 >= maxAttempts
      ) {
        // The operation's failure can win before a later disconnect. The
        // race's own cancellation error is marked at the abort event.
        throw providerError
      }

      const decision = classifyRetry(error)
      if (!decision.retry) {
        throw providerError
      }
      const delayMs = retryDelayMs(
        decision.response ?? null,
        attempt,
        retryBaseDelayMs
      )
      if (delayMs === null) {
        throw providerError
      }
      onRetry?.({
        attempt: attempt + 2,
        delayMs,
        maxAttempts,
      })
      await waitForRetry(delayMs, signal, callerSignal)
    }
  }

  throw new ProviderRequestError("unavailable")
}

export const fetchProviderRead = async (
  input: RequestInfo | URL,
  init: RequestInit = {},
  {
    maxAttempts = DEFAULT_PROVIDER_READ_ATTEMPTS,
    recordMetric,
    retryBaseDelayMs = DEFAULT_PROVIDER_RETRY_BASE_DELAY_MS,
    timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
  }: ProviderReadOptions = {}
): Promise<Response> => {
  const startedAt = performance.now()
  const inputMethod = input instanceof Request ? input.method : "GET"
  const method = (init.method ?? inputMethod).toUpperCase()
  if (method !== "GET" && method !== "HEAD") {
    throw new RangeError("Provider retries require a safe read method")
  }
  assertBoundedInteger(maxAttempts, "Provider read attempts", 3)
  assertBoundedInteger(
    retryBaseDelayMs,
    "Provider retry base delay",
    MAX_PROVIDER_RETRY_DELAY_MS
  )

  const signal = createProviderSignal(init.signal, timeoutMs)
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (signal.aborted) {
      safelyRecordProviderMetric(recordMetric, {
        durationMs: performance.now() - startedAt,
        result: "error",
      })
      throw new ProviderRequestError("timeout")
    }

    let response: Response
    try {
      response = await fetch(input, { ...init, signal })
    } catch (error) {
      const providerError = toProviderRequestError(error)
      if (providerError.kind === "timeout" || attempt + 1 >= maxAttempts) {
        safelyRecordProviderMetric(recordMetric, {
          durationMs: performance.now() - startedAt,
          result: "error",
        })
        throw providerError
      }
      const delayMs = retryDelayMs(null, attempt, retryBaseDelayMs)
      await waitForRetry(delayMs ?? retryBaseDelayMs, signal)
      continue
    }

    if (
      !isRetryableProviderReadStatus(response.status) ||
      attempt + 1 >= maxAttempts
    ) {
      safelyRecordProviderMetric(recordMetric, {
        durationMs: performance.now() - startedAt,
        result: response.ok ? "ok" : "error",
      })
      return response
    }

    const delayMs = retryDelayMs(response, attempt, retryBaseDelayMs)
    if (delayMs === null) {
      safelyRecordProviderMetric(recordMetric, {
        durationMs: performance.now() - startedAt,
        result: response.ok ? "ok" : "error",
      })
      return response
    }
    await cancelResponseBody(response)
    await waitForRetry(delayMs, signal)
  }

  safelyRecordProviderMetric(recordMetric, {
    durationMs: performance.now() - startedAt,
    result: "error",
  })
  throw new ProviderRequestError("unavailable")
}

export const providerProblem = (
  error: unknown,
  codePrefix: string
): {
  code: string
  detail: string
  status: 502 | 504
} | null => {
  if (!(error instanceof ProviderRequestError)) {
    return null
  }

  return error.kind === "timeout"
    ? {
        code: `${codePrefix}_timeout`,
        detail: "The upstream service did not respond in time.",
        status: 504,
      }
    : {
        code: `${codePrefix}_unavailable`,
        detail: "The upstream service is temporarily unavailable.",
        status: 502,
      }
}
