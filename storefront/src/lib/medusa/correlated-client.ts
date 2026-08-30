import "server-only"

import type { FetchArgs } from "@medusajs/js-sdk"

import { createUpstreamHeaders } from "@/lib/http/correlation"
import { fetchMedusaStoreRead } from "@/lib/medusa/read-client"

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

  return fetchMedusaStoreRead<T>(path, {
    ...init,
    headers,
    signal,
  })
}
