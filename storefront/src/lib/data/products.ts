import type { HttpTypes } from "@medusajs/types"
import { unstable_cache } from "next/cache"
import { z } from "zod"

import { runtimeEnv } from "@/config/env"
import { storeClient } from "@/lib/medusa"
import { resolveRegionId } from "@/lib/regions"

type StoreProduct = HttpTypes.StoreProduct

const isStoreProduct = (value: unknown): value is StoreProduct => {
  if (!value || typeof value !== "object") {
    return false
  }

  const handle = (value as { handle?: unknown }).handle
  return typeof handle === "string"
}

const extractProductsFromResponse = (response: unknown): StoreProduct[] => {
  if (!response || typeof response !== "object") {
    return []
  }

  const products = (response as { products?: unknown }).products
  if (!Array.isArray(products)) {
    return []
  }

  return products.filter(isStoreProduct)
}

const listProducts = async (query: HttpTypes.StoreProductListParams): Promise<StoreProduct[]> => {
  const regionId = query.region_id ?? (await resolveRegionId())
  const response = await storeClient.product.list({ ...query, region_id: regionId })
  return extractProductsFromResponse(response)
}

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
  "*categories.parent_category",
  "*variants",
  "variants.inventory_quantity",
  "variants.manage_inventory",
  "variants.allow_backorder",
  "*options",
  "*images",
  "*tags",
].join(",")

export const PRODUCT_DETAIL_FIELDS = [
  "id",
  "handle",
  "title",
  "subtitle",
  "description",
  "thumbnail",
  "metadata",
  "*collection",
  "*categories",
  "*categories.parent_category",
  "*variants",
  "variants.inventory_quantity",
  "variants.manage_inventory",
  "variants.allow_backorder",
  "*options",
  "*images",
  "*tags",
].join(",")

const getCollectionByHandle = unstable_cache(
  async (handle: string): Promise<HttpTypes.StoreCollection | null> => {
    try {
      const { collections } = await storeClient.collection.list({
        handle,
        limit: 1,
      })

      return collections[0] ?? null
    } catch (error) {
      console.error(`[getCollectionByHandle:${handle}] Failed to load collection`, error)
      return null
    }
  },
  ["collection-by-handle"],
  { revalidate: 1800, tags: ["collections"] }
)

export const getCollectionProductsByHandle = unstable_cache(
  async (handle: string, limit?: number): Promise<StoreProduct[]> => {
    try {
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

        const products = await listProducts({
          collection_id: collection.id,
          limit: pageLimit,
          offset,
          fields: PRODUCT_LIST_FIELDS,
        } satisfies HttpTypes.StoreProductListParams)
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
    } catch (error) {
      console.error(`[getCollectionProductsByHandle:${handle}] Failed to load`, error)
      return []
    }
  },
  ["collection-products-by-handle"],
  { revalidate: 900, tags: ["products", "collections"] }
)

export const getHomepageProducts = unstable_cache(
  async (): Promise<StoreProduct[]> => {
    try {
      return await listProducts({
        limit: 16,
        fields: PRODUCT_DETAIL_FIELDS,
      } satisfies HttpTypes.StoreProductListParams)
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
      const products = await listProducts({
        handle,
        limit: 1,
        fields: PRODUCT_DETAIL_FIELDS,
      } satisfies HttpTypes.StoreProductListParams)
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
  async (collectionId: string, limit: number = 8): Promise<StoreProduct[]> => {
    try {
      return await listProducts({
        collection_id: collectionId,
        limit,
        fields: PRODUCT_DETAIL_FIELDS,
      } satisfies HttpTypes.StoreProductListParams)
    } catch (error) {
      console.error("[getProductsByCollection] Failed to load products", error)
      return []
    }
  },
  ["products-by-collection"],
  { revalidate: 900, tags: ["products", "collections"] }
)

export const getRecentProducts = unstable_cache(
  async (limit: number = 8): Promise<StoreProduct[]> => {
    try {
      return await listProducts({
        limit,
        fields: PRODUCT_DETAIL_FIELDS,
      } satisfies HttpTypes.StoreProductListParams)
    } catch (error) {
      console.error("[getRecentProducts] Failed to load products", error)
      return []
    }
  },
  ["recent-products"],
  { revalidate: 600, tags: ["products"] }
)

export const getProductsByIds = async (
  productIds: readonly string[]
): Promise<StoreProduct[]> => {
  const ids = Array.from(
    new Set(productIds.map((id) => id.trim()).filter(Boolean))
  ).slice(0, 50)
  if (!ids.length) {
    return []
  }

  const cached = unstable_cache(
    async (): Promise<StoreProduct[]> => {
      try {
        const products = await listProducts({
          id: ids,
          limit: ids.length,
          fields: PRODUCT_LIST_FIELDS,
        } satisfies HttpTypes.StoreProductListParams)
        const byId = new Map(products.map((product) => [product.id, product]))
        return ids.flatMap((id) => {
          const product = byId.get(id)
          return product ? [product] : []
        })
      } catch (error) {
        console.error("[getProductsByIds] Failed to load products", error)
        return []
      }
    },
    ["products-by-ids", ...ids],
    { revalidate: 60, tags: ["products", "catalog-shelves"] }
  )

  return cached()
}

type ProductHandleSummary = {
  handle: string
  id: string
  updatedAt: string | null
}

const PRODUCT_HANDLE_PAGE_SIZE = 100
const PRODUCT_HANDLE_MAX_PAGES = 50
const PRODUCT_HANDLE_MAX_ENTRIES =
  PRODUCT_HANDLE_PAGE_SIZE * PRODUCT_HANDLE_MAX_PAGES
const productHandlePageSchema = z.object({
  handles: z
    .array(
      z.object({
        created_at: z.string().datetime().nullable(),
        handle: z.string().trim().min(1).max(200),
        id: z.string().trim().min(1).max(200),
        updated_at: z.string().datetime().nullable(),
      })
    )
    .max(PRODUCT_HANDLE_PAGE_SIZE),
  next_cursor: z
    .string()
    .trim()
    .min(1)
    .max(256)
    .regex(/^[A-Za-z0-9_-]+$/u)
    .nullable(),
})

export const getAllProductHandles = unstable_cache(
  async (
    maxEntries: number = PRODUCT_HANDLE_MAX_ENTRIES
  ): Promise<ProductHandleSummary[]> => {
    try {
      if (!runtimeEnv.medusaBackendUrl || !runtimeEnv.medusaPublishableKey) {
        throw new Error("Medusa product-handle configuration is unavailable")
      }

      const handles: ProductHandleSummary[] = []
      const seenCursors = new Set<string>()
      const seenProductIds = new Set<string>()
      let cursor: string | null = null
      const boundedMaxEntries = Math.min(
        Math.max(Math.trunc(maxEntries), 1),
        PRODUCT_HANDLE_MAX_ENTRIES
      )
      const maxPages = Math.ceil(
        boundedMaxEntries / PRODUCT_HANDLE_PAGE_SIZE
      )

      for (let page = 0; page < maxPages; page += 1) {
        const url = new URL(
          "/store/products/handles",
          runtimeEnv.medusaBackendUrl
        )
        url.searchParams.set(
          "limit",
          String(
            Math.min(
              PRODUCT_HANDLE_PAGE_SIZE,
              boundedMaxEntries - handles.length
            )
          )
        )
        if (cursor) {
          url.searchParams.set("cursor", cursor)
        }
        const response = await fetch(url.toString(), {
          headers: {
            "x-publishable-api-key": runtimeEnv.medusaPublishableKey,
          },
          next: { revalidate: 1800, tags: ["products"] },
          signal: AbortSignal.timeout(8_000),
        })
        if (!response.ok) {
          throw new Error(`Product handle feed failed with ${response.status}`)
        }
        const parsed = productHandlePageSchema.safeParse(await response.json())
        if (!parsed.success) {
          throw new Error("Product handle feed returned an invalid response")
        }

        parsed.data.handles.forEach((product) => {
          if (seenProductIds.has(product.id)) {
            return
          }
          seenProductIds.add(product.id)
          handles.push({
            handle: product.handle,
            id: product.id,
            updatedAt: product.updated_at ?? product.created_at,
          })
        })

        if (handles.length >= boundedMaxEntries) {
          cursor = parsed.data.next_cursor
          break
        }

        const nextCursor = parsed.data.next_cursor
        if (!nextCursor) {
          cursor = null
          break
        }
        if (seenCursors.has(nextCursor)) {
          throw new Error("Product handle feed repeated a cursor")
        }
        seenCursors.add(nextCursor)
        cursor = nextCursor
      }

      if (cursor && boundedMaxEntries === PRODUCT_HANDLE_MAX_ENTRIES) {
        console.error(
          `[getAllProductHandles] Stopped after ${PRODUCT_HANDLE_MAX_ENTRIES} products`
        )
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
