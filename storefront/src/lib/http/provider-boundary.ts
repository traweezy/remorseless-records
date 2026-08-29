export const DEFAULT_PROVIDER_TIMEOUT_MS = 8_000

export type ProviderFailureKind = "timeout" | "unavailable"

export class ProviderRequestError extends Error {
  readonly kind: ProviderFailureKind

  constructor(kind: ProviderFailureKind) {
    super(
      kind === "timeout"
        ? "The upstream provider request timed out"
        : "The upstream provider request failed"
    )
    this.name = "ProviderRequestError"
    this.kind = kind
  }
}

const isAbortLikeError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false
  }

  const name = (error as { name?: unknown }).name
  return name === "AbortError" || name === "TimeoutError"
}

export const toProviderRequestError = (
  error: unknown
): ProviderRequestError =>
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

export const providerProblem = (
  error: unknown,
  codePrefix: string
):
  | {
      code: string
      detail: string
      status: 502 | 504
    }
  | null => {
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
