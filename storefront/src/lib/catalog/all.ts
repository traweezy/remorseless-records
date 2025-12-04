import { backendBaseUrl, withBackendHeaders } from "@/config/backend"
import { mapStoreProductToSearchHit } from "@/lib/products/transformers"
import type { ProductSearchHit } from "@/types/product"
import type { HttpTypes } from "@medusajs/types"

export const getFullCatalogHits = async (): Promise<ProductSearchHit[]> => {
  const hits: ProductSearchHit[] = []
  const batchSize = 100
  let offset = 0
  const isStoreProduct = (value: unknown): value is HttpTypes.StoreProduct =>
    typeof value === "object" && value !== null && "handle" in value

  for (;;) {
    const url = new URL(`${backendBaseUrl}/store/products`)
    url.searchParams.set("limit", String(batchSize))
    url.searchParams.set("offset", String(offset))
    url.searchParams.set("order", "title")

    const response = await fetch(url.toString(), {
      cache: "force-cache",
      next: { revalidate: 900 },
      headers: withBackendHeaders(),
    })

    if (!response.ok) {
      break
    }

    const payload = (await response.json()) as { products?: unknown[] }
    const products = (Array.isArray(payload.products) ? payload.products : []).filter(isStoreProduct)

    if (!products?.length) {
      break
    }

    products.forEach((product) => {
      if (typeof product.handle !== "string" || !product.handle.trim().length) {
        return
      }
      hits.push(mapStoreProductToSearchHit(product))
    })

    if (products.length < batchSize) {
      break
    }

    offset += products.length
  }

  return hits
}
