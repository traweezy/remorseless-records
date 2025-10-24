import type { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"

const PRODUCTS_INDEX = "products"
const BATCH_SIZE = 100

const productRelations = [
  "collection",
  "tags",
  "images",
  "variants",
  "variants.prices",
  "variants.options",
  "variants.options.option",
  "options",
  "options.values",
]

export default async function reindexMeilisearch({
  container,
}: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  if (!container.hasRegistration("meilisearchService")) {
    logger.warn(
      "[meilisearch] Plugin is not configured. Skipping reindex operation."
    )
    return
  }

  const meilisearch = container.resolve("meilisearchService") as {
    deleteAllDocuments: (indexKey: string) => Promise<unknown>
    addDocuments: (
      indexKey: string,
      documents: unknown[],
      language?: string
    ) => Promise<unknown>
  }

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

    await meilisearch.addDocuments(PRODUCTS_INDEX, products)
    offset += products.length
    totalIndexed += products.length
  }

  logger.info(
    `[meilisearch] Indexed ${totalIndexed} product(s) into '${PRODUCTS_INDEX}'`
  )
}
