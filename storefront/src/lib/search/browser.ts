"use client"

import { useMemo } from "react"
import { MeiliSearch } from "meilisearch"

import { clientEnv } from "@/config/env"
import {
  type ProductSearchRequest,
  type ProductSearchResponse,
  searchProductsWithClient,
} from "@/lib/search/search"

let browserClient: MeiliSearch | null = null

const getBrowserClient = (): MeiliSearch => {
  if (browserClient) {
    return browserClient
  }

  browserClient = new MeiliSearch({
    host: clientEnv.meiliHost,
    apiKey: clientEnv.meiliSearchKey,
  })

  return browserClient
}

export const useBrowserSearchClient = (): MeiliSearch =>
  useMemo(() => getBrowserClient(), [])

export const searchProductsBrowser = async (
  request: ProductSearchRequest
): Promise<ProductSearchResponse> => {
  const client = getBrowserClient()
  return searchProductsWithClient(client, request)
}
