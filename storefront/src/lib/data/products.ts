import { cache } from "react"
import type { HttpTypes } from "@medusajs/types"

import { storeClient } from "@/lib/medusa"
import {
  buildProductSlugParts,
  type ProductSlug,
} from "@/lib/products/slug"

type StoreProduct = HttpTypes.StoreProduct

const getCollectionByHandle = cache(
  async (handle: string): Promise<HttpTypes.StoreCollection | null> => {
    const { collections } = await storeClient.collection.list({
      handle,
      limit: 1,
    })

    return collections[0] ?? null
  }
)

export const getCollectionProductsByHandle = cache(
  async (handle: string, limit?: number): Promise<StoreProduct[]> => {
    const collection = await getCollectionByHandle(handle)
    if (!collection?.id) {
      return []
    }

    const collected: StoreProduct[] = []
    const target = typeof limit === "number" && limit > 0 ? limit : Number.POSITIVE_INFINITY
    const pageSize = Number.isFinite(target) ? Math.min(target, 50) : 50
    let offset = 0

    // Medusa paginates collections; iterate until we load every product (or reach the caller-imposed ceiling).
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const pageLimit = Number.isFinite(target) ? Math.min(pageSize, target - collected.length) : pageSize
      if (pageLimit <= 0) {
        break
      }

      const { products } = await storeClient.product.list({
        collection_id: collection.id,
        limit: pageLimit,
        offset,
      })

      if (!products?.length) {
        break
      }

      const validProducts = products.filter(
        (product): product is StoreProduct =>
          typeof product.handle === "string" && product.handle.trim().length > 0
      )
      collected.push(...validProducts)

      if (collected.length >= target) {
        break
      }

      if (products.length < pageLimit) {
        break
      }

      offset += pageLimit
    }

    return collected
  }
)

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

type ProductHandleSummary = {
  handle: string
  slug: ProductSlug
  updatedAt: string | null
}

export const getAllProductHandles = cache(
  async (): Promise<ProductHandleSummary[]> => {
    const handles: ProductHandleSummary[] = []
    const pageSize = 100
    let offset = 0

    // Medusa paginates products; loop until we exhaust the catalog.
    // We request moderate batches to avoid stressing the API during build time.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { products } = await storeClient.product.list({
        limit: pageSize,
        offset,
        order: "created_at",
      })

      if (!products?.length) {
        break
      }

      for (const product of products) {
        if (!product?.handle) {
          continue
        }

        const updatedAt =
          (product as unknown as { updated_at?: string }).updated_at ??
          (product as unknown as { updatedAt?: string }).updatedAt ??
          (product as unknown as { created_at?: string }).created_at ??
          (product as unknown as { createdAt?: string }).createdAt ??
          null

        const slug = buildProductSlugParts(product)

        handles.push({
          handle: product.handle,
          slug,
          updatedAt,
        })
      }

      if (products.length < pageSize) {
        break
      }

      offset += products.length
    }

    return handles
  }
)
