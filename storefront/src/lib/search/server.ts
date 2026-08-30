import "server-only"

import { Meilisearch } from "meilisearch"

import { searchServerEnv } from "@/config/env.search.server"
import {
  isRetryableProviderReadStatus,
  type ProviderRetryDecision,
  type ProviderRetryEvent,
  runProviderReadOperation,
} from "@/lib/http/provider-boundary"
import { enrichSearchResponse } from "@/lib/search/enrich"
import {
  type ProductSearchRequest,
  type ProductSearchResponse,
  searchProductsWithClient,
} from "@/lib/search/search"

let serverClient: Meilisearch | null = null

const classifySearchRetry = (error: unknown): ProviderRetryDecision => {
  if (!error || typeof error !== "object") {
    return { retry: false }
  }

  const name = (error as { name?: unknown }).name
  if (name === "MeiliSearchRequestError") {
    return { retry: true }
  }

  const response = (error as { response?: unknown }).response
  return name === "MeiliSearchApiError" &&
    response instanceof Response &&
    isRetryableProviderReadStatus(response.status)
    ? { response, retry: true }
    : { retry: false }
}

const observeSearchRetry = ({
  attempt,
  delayMs,
  maxAttempts,
}: ProviderRetryEvent): void => {
  console.info("[search] Retrying transient provider read", {
    attempt,
    delay_ms: delayMs,
    max_attempts: maxAttempts,
  })
}

const getServerClient = (): Meilisearch => {
  if (serverClient) {
    return serverClient
  }

  serverClient = new Meilisearch({
    host: searchServerEnv.meiliHost,
    apiKey: searchServerEnv.meiliSearchKey,
  })

  return serverClient
}

export const searchProductsServer = async (
  request: ProductSearchRequest,
  signal?: AbortSignal | null
): Promise<ProductSearchResponse> => {
  const client = getServerClient()
  const response = await runProviderReadOperation<ProductSearchResponse>(
    (signal) => searchProductsWithClient(client, request, undefined, signal),
    {
      classifyRetry: classifySearchRetry,
      onRetry: observeSearchRetry,
      ...(signal !== undefined ? { signal } : {}),
    }
  )
  return enrichSearchResponse(response)
}
