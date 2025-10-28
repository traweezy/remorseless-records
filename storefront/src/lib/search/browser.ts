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

  const { limit = 24, offset = 0, sort, inStockOnly } = request

  try {
    return await searchProductsWithClient(client, request)
  } catch (error) {
    console.warn("Meilisearch unavailable, falling back to Medusa data.", error)

    try {
      const params = new URLSearchParams()
      params.set("limit", String(limit))
      params.set("offset", String(offset))
      if (sort) {
        params.set("sort", sort)
      }
      if (inStockOnly) {
        params.set("inStock", "true")
      }

      const fallbackResponse = await fetch(`/api/products?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      })

      if (!fallbackResponse.ok) {
        throw new Error(`Fallback request failed (${fallbackResponse.status})`)
      }

      const data = (await fallbackResponse.json()) as {
        products: HttpTypes.StoreProduct[]
        total?: number
        offset?: number
      }

      const hits = data.products
        .map(mapStoreProductToSearchHit)
        .filter((hit) => {
          if (!inStockOnly) {
            return true
          }
          const status = hit.stockStatus ?? (hit.defaultVariant?.inStock ? "in_stock" : "sold_out")
          return status !== "sold_out"
        })

      return {
        hits,
        total:
          typeof data.total === "number"
            ? data.total
            : offset + hits.length,
        offset: typeof data.offset === "number" ? data.offset : offset,
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
        offset: 0,
        facets: {
          genres: {},
          format: {},
        },
      }
    }
  }
}
