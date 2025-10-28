import { cache } from "react"
import type { HttpTypes } from "@medusajs/types"

import { storeClient } from "@/lib/medusa"
import {
  buildProductSlugParts,
  decodeSlugSegment,
  matchesProductSlug,
  type ProductSlug,
} from "@/lib/products/slug"

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

export const getProductBySlug = cache(
  async (artistSlug: string, albumSlug: string): Promise<StoreProduct | null> => {
    const candidateHandle = `${artistSlug}-${albumSlug}`
    const handleMatch = await getProductByHandle(candidateHandle)
    if (handleMatch && matchesProductSlug(handleMatch, artistSlug, albumSlug)) {
      return handleMatch
    }

    const query = `${decodeSlugSegment(artistSlug)} ${decodeSlugSegment(albumSlug)}`.trim()
    const { products } = await storeClient.product.list({
      q: query,
      limit: 24,
    })

    const match = products.find((product) =>
      matchesProductSlug(product, artistSlug, albumSlug)
    )

    return match ?? null
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
