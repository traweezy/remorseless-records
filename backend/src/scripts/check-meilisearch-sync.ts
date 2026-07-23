import type { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils"

import { resolveMeilisearchService } from "./meilisearch-service"

const PRODUCTS_INDEX = "products"

type CatalogReadModelIntegrity = {
  contradictoryStockCount: number
  nonPublishedCount: number
  unknownStockCount: number
}

export const assertCatalogReadModelIntegrity = ({
  contradictoryStockCount,
  nonPublishedCount,
  unknownStockCount,
}: CatalogReadModelIntegrity): void => {
  if (nonPublishedCount > 0) {
    throw new Error(
      `[meilisearch] ${nonPublishedCount} non-published product(s) are exposed in the catalog index.`
    )
  }
  if (contradictoryStockCount > 0) {
    throw new Error(
      `[meilisearch] ${contradictoryStockCount} published product(s) are marked sold out while also reporting available variants.`
    )
  }
  if (unknownStockCount > 0) {
    throw new Error(
      `[meilisearch] ${unknownStockCount} published product(s) have unknown stock after a full reindex.`
    )
  }
}

export const assertPublishedProductParity = ({
  indexedCount,
  publishedProductCount,
}: {
  indexedCount: number
  publishedProductCount: number
}): void => {
  if (publishedProductCount !== indexedCount) {
    throw new Error(
      `[meilisearch] Published product count in Medusa (${publishedProductCount}) does not match indexed documents (${indexedCount}).`
    )
  }
}

const searchCount = async (
  index: {
    search: (
      query: string,
      options: Record<string, unknown>
    ) => Promise<{ estimatedTotalHits?: number; totalHits?: number }>
  },
  filter: string
): Promise<number> => {
  const result = await index.search("", { limit: 0, filter })
  return result.estimatedTotalHits ?? result.totalHits ?? 0
}

export default async function checkMeilisearchSync({
  container,
}: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const meilisearch = resolveMeilisearchService<{
    getIndex: (indexKey: string) => {
      getStats: () => Promise<{ numberOfDocuments: number }>
      search: (
        query: string,
        options: Record<string, unknown>
      ) => Promise<{ estimatedTotalHits?: number; totalHits?: number }>
    }
  }>(container)

  const productModuleService = container.resolve(Modules.PRODUCT) as {
    listAndCountProducts: (
      filters?: Record<string, unknown>,
      config?: Record<string, unknown>
    ) => Promise<[unknown[], number]>
  }

  const [, publishedProductCount] =
    await productModuleService.listAndCountProducts(
      { status: ProductStatus.PUBLISHED },
      { take: 0 }
    )

  const index = meilisearch.getIndex(PRODUCTS_INDEX)
  const stats = await index.getStats()
  const indexedCount = stats.numberOfDocuments ?? 0

  logger.info(
    `[meilisearch] Published product count in Medusa: ${publishedProductCount}. Indexed documents: ${indexedCount}.`
  )

  assertPublishedProductParity({ indexedCount, publishedProductCount })
  logger.info("[meilisearch] Published counts match. Index is synchronized.")

  const [contradictoryStockCount, nonPublishedCount, unknownStockCount] =
    await Promise.all([
      searchCount(
        index,
        'status = "published" AND stock_status = "sold_out" AND availability_states = "available"'
      ),
      searchCount(index, 'status != "published"'),
      searchCount(index, 'status = "published" AND stock_status = "unknown"'),
    ])

  assertCatalogReadModelIntegrity({
    contradictoryStockCount,
    nonPublishedCount,
    unknownStockCount,
  })
  logger.info("[meilisearch] Published stock-state invariants pass.")
}
