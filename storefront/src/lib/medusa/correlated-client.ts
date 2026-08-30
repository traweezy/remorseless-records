import "server-only"

import { FetchError, type FetchArgs } from "@medusajs/js-sdk"

import { createUpstreamHeaders } from "@/lib/http/correlation"
import {
  isRetryableProviderReadStatus,
  type ProviderRetryDecision,
  type ProviderRetryEvent,
  runProviderReadOperation,
} from "@/lib/http/provider-boundary"
import { medusa } from "@/lib/medusa/client"

const classifyMedusaReadRetry = (
  error: unknown
): ProviderRetryDecision => {
  if (error instanceof FetchError) {
    return typeof error.status === "number" &&
      isRetryableProviderReadStatus(error.status)
      ? { retry: true }
      : { retry: false }
  }

  return error instanceof TypeError ? { retry: true } : { retry: false }
}

const observeMedusaReadRetry = ({
  attempt,
  delayMs,
  maxAttempts,
}: ProviderRetryEvent): void => {
  console.info("[medusa] Retrying transient provider read", {
    attempt,
    delay_ms: delayMs,
    max_attempts: maxAttempts,
  })
}

const requestReadSignal = (
  request: Request,
  callerSignal: AbortSignal | null | undefined
): AbortSignal =>
  callerSignal && callerSignal !== request.signal
    ? AbortSignal.any([request.signal, callerSignal])
    : request.signal

export const correlatedMedusaFetch = async <T>(
  request: Request,
  path: string,
  init: FetchArgs = {}
): Promise<T> => {
  const method = (init.method ?? "GET").toUpperCase()
  if (method !== "GET" && method !== "HEAD") {
    throw new RangeError("Correlated Medusa retries require a safe read method")
  }

  const headers = Object.fromEntries(
    createUpstreamHeaders(request, init.headers as HeadersInit).entries()
  )
  const signal = requestReadSignal(request, init.signal)

  return runProviderReadOperation<T>(
    (providerSignal) =>
      medusa.client.fetch<T>(path, {
        ...init,
        headers,
        signal: providerSignal,
      }),
    {
      classifyRetry: classifyMedusaReadRetry,
      onRetry: observeMedusaReadRetry,
      signal,
    }
  )
}
