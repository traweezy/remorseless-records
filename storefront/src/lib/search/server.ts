import "server-only"

import { MeiliSearch } from "meilisearch"

import { runtimeEnv } from "@/config/env"
import {
  type ProductSearchRequest,
  type ProductSearchResponse,
  searchProductsWithClient,
} from "@/lib/search/search"

let serverClient: MeiliSearch | null = null

const getServerClient = (): MeiliSearch => {
  if (serverClient) {
    return serverClient
  }

  if (!runtimeEnv.meiliHost || !runtimeEnv.meiliSearchKey) {
    throw new Error(
      "Meilisearch configuration missing. Ensure NEXT_PUBLIC_MEILI_HOST and NEXT_PUBLIC_MEILI_SEARCH_KEY are set."
    )
  }

  serverClient = new MeiliSearch({
    host: runtimeEnv.meiliHost,
    apiKey: runtimeEnv.meiliSearchKey,
  })

  return serverClient
}

export const searchProductsServer = async (
  request: ProductSearchRequest
): Promise<ProductSearchResponse> => {
  const client = getServerClient()
  return searchProductsWithClient(client, request)
}
