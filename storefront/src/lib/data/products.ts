import { cache } from "react"
import type { HttpTypes } from "@medusajs/types"

import { backendBaseUrl, withBackendHeaders } from "@/config/backend"
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

const backendBase = backendBaseUrl
const buildBackendHeaders = () => withBackendHeaders()

const getCollectionByHandle = cache(async (handle: string): Promise<HttpTypes.StoreCollection | null> => {
  const url = new URL(`${backendBase}/store/collections`)
  url.searchParams.set("handle", handle)

  const response = await fetch(url.toString(), {
    cache: "force-cache",
    next: { revalidate: 1800 },
    headers: buildBackendHeaders(),
  })
  if (!response.ok) {
    return null
  }
  const payload = (await response.json()) as { collections?: HttpTypes.StoreCollection[] }
  return payload.collections?.[0] ?? null
})

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
    for (;;) {
      const pageLimit = Number.isFinite(target) ? Math.min(pageSize, target - collected.length) : pageSize
      if (pageLimit <= 0) {
        break
      }

      const response = await fetch(
        `${backendBase}/store/products?collection=${collection.id}&limit=${pageLimit}&offset=${offset}`,
        {
          cache: "force-cache",
          next: { revalidate: 1800 },
          headers: buildBackendHeaders(),
        }
      )
      if (!response.ok) {
        break
      }
      const payload = (await response.json()) as { products?: StoreProduct[] }
      const products = payload.products ?? []

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
  try {
    const response = await fetch(`${backendBase}/store/products?limit=16`, {
      cache: "force-cache",
      next: { revalidate: 600 },
      headers: buildBackendHeaders(),
    })
    if (!response.ok) {
      return []
    }
    const payload = (await response.json()) as { products?: StoreProduct[] }
    return payload.products ?? []
  } catch (error) {
    console.error("[getHomepageProducts] Failed to load products", error)
    return []
  }
})

export const getProductByHandle = cache(
  async (handle: string): Promise<StoreProduct | null> => {
    try {
      const response = await fetch(
        `${backendBase}/store/products/${encodeURIComponent(handle)}`,
        {
          cache: "force-cache",
          next: { revalidate: 3600 },
          headers: buildBackendHeaders(),
        }
      )
      if (!response.ok) {
        return null
      }
      const payload = (await response.json()) as { product?: StoreProduct }
      return payload.product ?? null
    } catch (error) {
      console.error("[getProductByHandle] Failed to load product", error)
      return null
    }
  }
)

export const getProductsByCollection = cache(
  async (collectionId: string, limit = 8): Promise<StoreProduct[]> => {
    try {
      const response = await fetch(
        `${backendBase}/store/products?collection=${encodeURIComponent(collectionId)}&limit=${limit}`,
        {
          cache: "force-cache",
          next: { revalidate: 1800 },
          headers: buildBackendHeaders(),
        }
      )
      if (!response.ok) {
        return []
      }
      const payload = (await response.json()) as { products?: StoreProduct[] }
      return payload.products ?? []
    } catch (error) {
      console.error("[getProductsByCollection] Failed to load products", error)
      return []
    }
  }
)

export const getRecentProducts = cache(
  async (limit = 8): Promise<StoreProduct[]> => {
    try {
      const response = await fetch(`${backendBase}/store/products?limit=${limit}`, {
        cache: "force-cache",
        next: { revalidate: 900 },
        headers: buildBackendHeaders(),
      })
      if (!response.ok) {
        return []
      }
      const payload = (await response.json()) as { products?: StoreProduct[] }
      return payload.products ?? []
    } catch (error) {
      console.error("[getRecentProducts] Failed to load products", error)
      return []
    }
  }
)

type ProductHandleSummary = {
  handle: string
  slug: ProductSlug
  updatedAt: string | null
}

export const getAllProductHandles = cache(
  async (): Promise<ProductHandleSummary[]> => {
    try {
      const response = await fetch(`${backendBase}/store/products/handles`, {
        cache: "force-cache",
        next: { revalidate: 3600 },
        headers: buildBackendHeaders(),
      })
      if (!response.ok) {
        throw new Error(`Failed to load product handles: ${response.status}`)
      }
      const payload = (await response.json()) as {
        handles?: Array<{ handle: string; updated_at?: string | null; created_at?: string | null }>
      }
      const handles = payload.handles ?? []
      return handles
        .filter((entry) => typeof entry.handle === "string" && entry.handle.trim().length > 0)
        .map((entry) => {
          const slug = buildProductSlugParts({
            handle: entry.handle,
            metadata: null,
            title: null,
            collection: null,
          })
          return {
            handle: entry.handle,
            slug,
            updatedAt: entry.updated_at ?? entry.created_at ?? null,
          }
        })
    } catch (error) {
      console.error("[getAllProductHandles] Failed to load products", error)
      return []
    }
  }
)
