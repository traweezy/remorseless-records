import { unstable_cache } from "next/cache"

import { PRODUCT_LIST_FIELDS } from "@/lib/data/products"
import { mapStoreProductToSearchHit } from "@/lib/products/transformers"
import type { ProductSearchHit } from "@/types/product"
import { storeClient } from "@/lib/medusa"

const CATALOG_CACHE_KEY = "full-catalog-hits-v2"

export const getFullCatalogHits = unstable_cache(
  async (): Promise<ProductSearchHit[]> => {
    try {
      const hits: ProductSearchHit[] = []
      const batchSize = 100
      let offset = 0

      for (;;) {
        const { products } = await storeClient.product.list({
          limit: batchSize,
          offset,
          order: "title",
          fields: PRODUCT_LIST_FIELDS,
        })

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
    } catch (error) {
      console.error("[getFullCatalogHits] Failed to load catalog", error)
      return []
    }
  },
  [CATALOG_CACHE_KEY],
  { revalidate: 900, tags: ["products", CATALOG_CACHE_KEY] }
)
