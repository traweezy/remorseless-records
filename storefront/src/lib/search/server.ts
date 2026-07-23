import "server-only"

import { Meilisearch } from "meilisearch"

import { runtimeEnv } from "@/config/env"
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

  if (!runtimeEnv.meiliHost || !runtimeEnv.meiliSearchKey) {
    throw new Error(
      "Meilisearch configuration missing. Ensure NEXT_PUBLIC_MEILI_HOST and NEXT_PUBLIC_MEILI_SEARCH_KEY are set."
    )
  }

  serverClient = new Meilisearch({
    host: runtimeEnv.meiliHost,
    apiKey: runtimeEnv.meiliSearchKey,
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
