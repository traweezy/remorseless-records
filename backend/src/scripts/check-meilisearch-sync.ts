import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

const PRODUCTS_INDEX = "products"

export default async function checkMeilisearchSync({
  container,
}: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  if (!container.hasRegistration("meilisearchService")) {
    logger.warn(
      "[meilisearch] Plugin is not configured. Cannot verify search index."
    )
    return
  }

  const meilisearch = container.resolve("meilisearchService") as {
    getIndex: (indexKey: string) => {
      getStats: () => Promise<{ numberOfDocuments: number }>
    }
  }

  const productModuleService = container.resolve(Modules.PRODUCT) as {
    listAndCountProducts: (
      filters?: Record<string, unknown>,
      config?: Record<string, unknown>
    ) => Promise<[unknown[], number]>
  }

  const [, productCount] = await productModuleService.listAndCountProducts({}, {
    take: 0,
  })

  const stats = await meilisearch.getIndex(PRODUCTS_INDEX).getStats()
  const indexedCount = stats.numberOfDocuments ?? 0

  logger.info(
    `[meilisearch] Product count in Medusa: ${productCount}. Indexed documents: ${indexedCount}.`
  )

  if (productCount !== indexedCount) {
    logger.warn(
      "[meilisearch] Counts differ. Run `pnpm --filter backend run search:rebuild` and confirm product events are reaching Meilisearch."
    )
  } else {
    logger.info("[meilisearch] Counts match. Index appears synchronized.")
  }
}
