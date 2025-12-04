import type { HttpTypes } from "@medusajs/types"
import { unstable_cache } from "next/cache"

import { storeClient } from "@/lib/medusa"
import {
  buildProductSlugParts,
  type ProductSlug,
} from "@/lib/products/slug"

type StoreProduct = HttpTypes.StoreProduct

export const PRODUCT_LIST_FIELDS = [
  "id",
  "handle",
  "title",
  "subtitle",
  "description",
  "thumbnail",
  "metadata",
  "*collection",
  "*categories",
  "*variants",
  "*options",
  "*images",
  "*tags",
].join(",")

const PRODUCT_DETAIL_FIELDS = [
  "id",
  "handle",
  "title",
  "subtitle",
  "description",
  "thumbnail",
  "metadata",
  "*collection",
  "*categories",
  "*variants",
  "*options",
  "*images",
  "*tags",
].join(",")

const getCollectionByHandle = unstable_cache(
  async (handle: string): Promise<HttpTypes.StoreCollection | null> => {
    const { collections } = await storeClient.collection.list({
      handle,
      limit: 1,
    })

    return collections[0] ?? null
  },
  ["collection-by-handle"],
  { revalidate: 1800, tags: ["collections"] }
)

export const getCollectionProductsByHandle = unstable_cache(
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
    for (;;) {
      const pageLimit = Number.isFinite(target) ? Math.min(pageSize, target - collected.length) : pageSize
      if (pageLimit <= 0) {
        break
      }

      const { products } = await storeClient.product.list({
        collection_id: collection.id,
        limit: pageLimit,
        offset,
        fields: PRODUCT_LIST_FIELDS,
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
  },
  ["collection-products-by-handle"],
  { revalidate: 900, tags: ["products", "collections"] }
)

export const getHomepageProducts = unstable_cache(
  async (): Promise<StoreProduct[]> => {
    try {
      const { products } = await storeClient.product.list({
        limit: 16,
        fields: PRODUCT_DETAIL_FIELDS,
      })
      return products
    } catch (error) {
      console.error("[getHomepageProducts] Failed to load products", error)
      return []
    }
  },
  ["homepage-products"],
  { revalidate: 600, tags: ["products"] }
)

export const getProductByHandle = unstable_cache(
  async (handle: string): Promise<StoreProduct | null> => {
    try {
      const { products } = await storeClient.product.list({
        handle,
        limit: 1,
        fields: PRODUCT_DETAIL_FIELDS,
      })
      return products[0] ?? null
    } catch (error) {
      console.error("[getProductByHandle] Failed to load product", error)
      return null
    }
  },
  ["product-by-handle"],
  { revalidate: 300, tags: ["products"] }
)

export const getProductsByCollection = unstable_cache(
  async (collectionId: string, limit = 8): Promise<StoreProduct[]> => {
    try {
      const { products } = await storeClient.product.list({
        collection_id: collectionId,
        limit,
        fields: PRODUCT_DETAIL_FIELDS,
      })
      return products
    } catch (error) {
      console.error("[getProductsByCollection] Failed to load products", error)
      return []
    }
  },
  ["products-by-collection"],
  { revalidate: 900, tags: ["products", "collections"] }
)

export const getRecentProducts = unstable_cache(
  async (limit = 8): Promise<StoreProduct[]> => {
    try {
      const { products } = await storeClient.product.list({
        limit,
        fields: PRODUCT_DETAIL_FIELDS,
      })
      return products
    } catch (error) {
      console.error("[getRecentProducts] Failed to load products", error)
      return []
    }
  },
  ["recent-products"],
  { revalidate: 600, tags: ["products"] }
)

type ProductHandleSummary = {
  handle: string
  slug: ProductSlug
  updatedAt: string | null
}

export const getAllProductHandles = unstable_cache(
  async (): Promise<ProductHandleSummary[]> => {
    try {
      const handles: ProductHandleSummary[] = []
      const pageSize = 100
      let offset = 0

      // Medusa paginates products; loop until we exhaust the catalog.
      // We request moderate batches to avoid stressing the API during build time.
      for (;;) {
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
    } catch (error) {
      console.error("[getAllProductHandles] Failed to load products", error)
      return []
    }
  },
  ["all-product-handles"],
  { revalidate: 1800, tags: ["products"] }
)
