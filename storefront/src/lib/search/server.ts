import "server-only"

import { Meilisearch } from "meilisearch"

import { searchServerEnv } from "@/config/env.search.server"
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
  const response = await searchProductsWithClient(client, request)
  return enrichSearchResponse(response)
}
