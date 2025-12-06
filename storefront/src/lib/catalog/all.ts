import { unstable_cache } from "next/cache"

import { PRODUCT_LIST_FIELDS } from "@/lib/data/products"
import { mapStoreProductToSearchHit } from "@/lib/products/transformers"
import type { ProductSearchHit } from "@/types/product"
import { storeClient } from "@/lib/medusa"
import { safeLogError } from "@/lib/logging"

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
      safeLogError("[getFullCatalogHits] Failed to load catalog", error)
      return []
    }
  },
  ["full-catalog-hits"],
  { revalidate: 900, tags: ["products"] }
)
