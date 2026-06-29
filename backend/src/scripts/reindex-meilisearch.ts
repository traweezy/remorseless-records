import type { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"

import { resolveMeilisearchService } from "./meilisearch-service"

const PRODUCTS_INDEX = "products"
const BATCH_SIZE = 100

const productRelations = [
  "collection",
  "tags",
  "images",
  "metadata",
  "variants",
  "variants.prices",
  "variants.options",
  "variants.options.option",
  "options",
  "options.values",
  "categories",
  "categories.parent_category",
  "categories.parent_category.parent_category",
]

export default async function reindexMeilisearch({
  container,
}: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const meilisearch = resolveMeilisearchService<{
    deleteAllDocuments: (indexKey: string) => Promise<unknown>
    addDocuments: (
      indexKey: string,
      documents: unknown[],
      type?: string,
      options?: Record<string, unknown>
    ) => Promise<unknown>
  }>(container)

  const productModuleService = container.resolve(Modules.PRODUCT) as {
    listAndCountProducts: (
      filters?: Record<string, unknown>,
      config?: {
        relations?: string[]
        skip?: number
        take?: number
      }
    ) => Promise<[unknown[], number]>
  }

  logger.info("[meilisearch] Rebuilding product index…")

  await meilisearch.deleteAllDocuments(PRODUCTS_INDEX).catch((error) => {
    const message =
      error instanceof Error ? error.message : String(error ?? "unknown error")
    logger.warn(
      `[meilisearch] Failed to clear existing documents before reindexing: ${message}`
    )
  })

  let offset = 0
  let totalIndexed = 0
  let total = 0

  while (true) {
    const [products, count] = await productModuleService.listAndCountProducts(
      {},
      {
        relations: productRelations,
        skip: offset,
        take: BATCH_SIZE,
      }
    )

    if (!total) {
      total = count ?? 0
    }

    if (!products.length) {
      break
    }

    await meilisearch.addDocuments(PRODUCTS_INDEX, products, "products", {
      container,
    })
    offset += products.length
    totalIndexed += products.length
  }

  logger.info(
    `[meilisearch] Indexed ${totalIndexed} product(s) into '${PRODUCTS_INDEX}'`
  )
}
