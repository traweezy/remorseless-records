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
  getIndex: (indexKey: string) => {
    getSettings: () => Promise<Record<string, unknown>>
  }
}

const normalizeAttributeList = (raw: unknown): string[] => {
  if (!raw) {
    return []
  }

  if (Array.isArray(raw)) {
    return raw
      .flatMap((entry) => {
        if (typeof entry === "string") {
          return entry
        }
        if (entry && typeof entry === "object" && "attribute" in entry) {
          const attribute = (entry as { attribute?: unknown }).attribute
          return typeof attribute === "string" ? attribute : null
        }
        return null
      })
      .filter((value): value is string => Boolean(value))
  }

  return []
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

  const expectedSettings = productConfig.indexSettings ?? {}
  const currentSettings = await meilisearch.getIndex(PRODUCTS_INDEX).getSettings()

  const comparisons = [
    {
      label: "searchableAttributes",
      expected: normalizeAttributeList(expectedSettings.searchableAttributes),
      actual: normalizeAttributeList(currentSettings.searchableAttributes),
    },
    {
      label: "displayedAttributes",
      expected: normalizeAttributeList(expectedSettings.displayedAttributes),
      actual: normalizeAttributeList(currentSettings.displayedAttributes),
    },
    {
      label: "filterableAttributes",
      expected: normalizeAttributeList(expectedSettings.filterableAttributes),
      actual: normalizeAttributeList(currentSettings.filterableAttributes),
    },
    {
      label: "sortableAttributes",
      expected: normalizeAttributeList(expectedSettings.sortableAttributes),
      actual: normalizeAttributeList(currentSettings.sortableAttributes),
    },
  ]

  const mismatches: string[] = []

  comparisons.forEach(({ label, expected, actual }) => {
    if (!expected.length) {
      return
    }

    const missing = expected.filter(
      (value) => !actual.includes(value)
    )

    if (missing.length) {
      mismatches.push(`${label}: missing [${missing.join(", ")}]`)
    }
  })

  if (mismatches.length) {
    throw new Error(
      `[meilisearch] Synchronization incomplete. Missing attributes -> ${mismatches.join(
        "; "
      )}`
    )
  }

  logger.info("[meilisearch] Synchronized index settings for 'products' and validated attributes.")
}
