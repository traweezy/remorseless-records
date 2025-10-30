import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import indexSettings from "../../config/meilisearch-settings.json"

const PRODUCTS_INDEX = "products"

type MeilisearchService = {
  updateSettings: (
    indexKey: string,
    settings: {
      primaryKey?: string
      indexSettings?: Record<string, unknown>
    }
  ) => Promise<unknown>
}

export default async function syncMeilisearchSettings({
  container,
}: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  if (!container.hasRegistration("meilisearchService")) {
    logger.warn(
      "[meilisearch] Plugin is not configured. Skipping settings synchronization."
    )
    return
  }

  const meilisearch = container.resolve("meilisearchService") as MeilisearchService
  const productConfig = indexSettings.products

  if (!productConfig) {
    logger.warn(
      "[meilisearch] Missing product index settings definition. Skipping settings synchronization."
    )
    return
  }

  await meilisearch.updateSettings(PRODUCTS_INDEX, {
    primaryKey: productConfig.primaryKey,
    indexSettings: productConfig.indexSettings ?? {},
  })

  logger.info("[meilisearch] Synchronized index settings for 'products'.")
}
