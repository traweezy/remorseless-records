"use client"

import { useMemo } from "react"
import type { HttpTypes } from "@medusajs/types"
import { MeiliSearch } from "meilisearch"

import { clientEnv } from "@/config/env"
import {
  type ProductSearchRequest,
  type ProductSearchResponse,
  searchProductsWithClient,
} from "@/lib/search/search"
import { mapStoreProductToSearchHit } from "@/lib/products/transformers"

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

  try {
    return await searchProductsWithClient(client, request)
  } catch (error) {
    console.warn("Meilisearch unavailable, falling back to Medusa data.", error)

    try {
      const fallbackResponse = await fetch(
        `/api/products?limit=${encodeURIComponent(
          request.limit ?? 24
        )}`,
        {
          method: "GET",
          cache: "no-store",
        }
      )

      if (!fallbackResponse.ok) {
        throw new Error(`Fallback request failed (${fallbackResponse.status})`)
      }

      const data = (await fallbackResponse.json()) as {
        products: HttpTypes.StoreProduct[]
      }

      const hits = data.products.map(mapStoreProductToSearchHit)

      return {
        hits,
        total: hits.length,
        facets: {
          genres: {},
          format: {},
        },
      }
    } catch (fallbackError) {
      console.error("Unable to load fallback products", fallbackError)
      return {
        hits: [],
        total: 0,
        facets: {
          genres: {},
          format: {},
        },
      }
    }
  }
}
