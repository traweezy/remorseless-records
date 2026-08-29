import "server-only"

import { Meilisearch } from "meilisearch"

import { searchServerEnv } from "@/config/env.search.server"
import {
  createProviderSignal,
  toProviderRequestError,
} from "@/lib/http/provider-boundary"
import { enrichSearchResponse } from "@/lib/search/enrich"
import {
  type ProductSearchRequest,
  type ProductSearchResponse,
  searchProductsWithClient,
} from "@/lib/search/search"

let serverClient: Meilisearch | null = null

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
  request: ProductSearchRequest
): Promise<ProductSearchResponse> => {
  const client = getServerClient()
  let response: ProductSearchResponse
  try {
    response = await searchProductsWithClient(
      client,
      request,
      undefined,
      createProviderSignal()
    )
  } catch (error) {
    throw toProviderRequestError(error)
  }
  return enrichSearchResponse(response)
}
