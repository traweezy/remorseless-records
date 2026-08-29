import { unstable_cache } from "next/cache"

import {
  getAllProductHandles,
  PRODUCT_LIST_FIELDS,
} from "@/lib/data/products"
import { mapStoreProductToSearchHit } from "@/lib/products/transformers"
import type { ProductSearchHit } from "@/types/product"
import { storeClient } from "@/lib/medusa"
import { resolveRegionId } from "@/lib/regions"

const CATALOG_CACHE_KEY = "full-catalog-hits-v2"
const FULL_CATALOG_MAX_PRODUCTS = 1_000
const FULL_CATALOG_BATCH_SIZE = 100

export const getFullCatalogHits = unstable_cache(
  async (): Promise<ProductSearchHit[]> => {
    try {
      const hits: ProductSearchHit[] = []
      const handleRecords = await getAllProductHandles(
        FULL_CATALOG_MAX_PRODUCTS
      )
      const regionId = await resolveRegionId()

      for (
        let index = 0;
        index < handleRecords.length;
        index += FULL_CATALOG_BATCH_SIZE
      ) {
        const productIds = handleRecords
          .slice(index, index + FULL_CATALOG_BATCH_SIZE)
          .map((record) => record.id)
        const { products } = await storeClient.product.list({
          id: productIds,
          limit: productIds.length,
          fields: PRODUCT_LIST_FIELDS,
          region_id: regionId,
        })

        products.forEach((product) => {
          if (
            typeof product.handle !== "string" ||
            !product.handle.trim().length
          ) {
            return
          }
          hits.push(mapStoreProductToSearchHit(product))
        })
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
