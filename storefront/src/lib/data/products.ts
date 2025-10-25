import { cache } from "react"
import type { HttpTypes } from "@medusajs/types"

import { storeClient } from "@/lib/medusa"

type StoreProduct = HttpTypes.StoreProduct

export const getHomepageProducts = cache(async (): Promise<StoreProduct[]> => {
  const { products } = await storeClient.product.list({
    limit: 16,
  })
  return products
})

export const getProductByHandle = cache(
  async (handle: string): Promise<StoreProduct | null> => {
    const { products } = await storeClient.product.list({
      handle,
      limit: 1,
    })
    return products[0] ?? null
  }
)

export const getProductsByCollection = cache(
  async (collectionId: string, limit = 8): Promise<StoreProduct[]> => {
    const { products } = await storeClient.product.list({
      collection_id: collectionId,
      limit,
    })
    return products
  }
)

export const getRecentProducts = cache(
  async (limit = 8): Promise<StoreProduct[]> => {
    const { products } = await storeClient.product.list({
      limit,
    })
    return products
  }
)
