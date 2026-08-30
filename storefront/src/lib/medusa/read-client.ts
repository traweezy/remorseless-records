import "server-only"

import { FetchError, type FetchArgs } from "@medusajs/js-sdk"

import {
  isRetryableProviderReadStatus,
  type ProviderRetryDecision,
  type ProviderRetryEvent,
  runProviderReadOperation,
} from "@/lib/http/provider-boundary"
import { medusa } from "@/lib/medusa/client"

const classifyMedusaReadRetry = (error: unknown): ProviderRetryDecision => {
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

export const fetchMedusaStoreRead = async <T>(
  path: string,
  init: FetchArgs = {}
): Promise<T> => {
  const method = (init.method ?? "GET").toUpperCase()
  if (method !== "GET" && method !== "HEAD") {
    throw new RangeError("Medusa retries require a safe read method")
  }

  return runProviderReadOperation<T>(
    (providerSignal) =>
      medusa.client.fetch<T>(path, {
        ...init,
        signal: providerSignal,
      }),
    {
      classifyRetry: classifyMedusaReadRetry,
      onRetry: observeMedusaReadRetry,
      ...(init.signal !== undefined ? { signal: init.signal } : {}),
    }
  )
}
