import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import indexSettings from "../../config/meilisearch-settings.json"
import { asUnknownRecord } from "../lib/provider-boundary/records"
import { resolveMeilisearchService } from "./meilisearch-service"

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

export const normalizeAttributeList = (raw: unknown): string[] => {
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

const areEqual = (left: unknown, right: unknown): boolean => {
  return JSON.stringify(left) === JSON.stringify(right)
}

const isConfiguredSubset = (actual: unknown, expected: unknown): boolean => {
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) {
    return areEqual(actual, expected)
  }
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
    return false
  }

  const actualRecord = asUnknownRecord(actual)
  if (!actualRecord) {
    return false
  }
  return Object.entries(expected).every(([key, value]) => {
    return isConfiguredSubset(actualRecord[key], value)
  })
}

export const assertConfiguredIndexSettings = ({
  actual,
  expected,
  indexKey,
}: {
  actual: Record<string, unknown>
  expected: Record<string, unknown>
  indexKey: string
}): void => {
  const attributeKeys = [
    "searchableAttributes",
    "displayedAttributes",
    "filterableAttributes",
    "sortableAttributes",
    "rankingRules",
  ] as const
  const mismatches: string[] = []

  attributeKeys.forEach((key) => {
    if (!(key in expected)) {
      return
    }

    const expectedValues = normalizeAttributeList(expected[key])
    const actualValues = normalizeAttributeList(actual[key])
    const orderMatters =
      key === "searchableAttributes" || key === "rankingRules"
    const normalizedExpected = orderMatters
      ? expectedValues
      : [...expectedValues].sort()
    const normalizedActual = orderMatters
      ? actualValues
      : [...actualValues].sort()
    if (!areEqual(normalizedActual, normalizedExpected)) {
      mismatches.push(
        `${key}: expected [${expectedValues.join(", ")}], received [${actualValues.join(", ")}]`
      )
    }
  })

  if (
    "typoTolerance" in expected &&
    !isConfiguredSubset(actual.typoTolerance, expected.typoTolerance)
  ) {
    mismatches.push("typoTolerance differs from the configured value")
  }

  if (mismatches.length) {
    throw new Error(
      `[meilisearch] Settings for '${indexKey}' do not match configuration: ${mismatches.join(
        "; "
      )}`
    )
  }
}

export default async function syncMeilisearchSettings({
  container,
}: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const meilisearch = resolveMeilisearchService<MeilisearchService>(container)
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
  const currentSettings = await meilisearch
    .getIndex(PRODUCTS_INDEX)
    .getSettings()

  assertConfiguredIndexSettings({
    actual: currentSettings,
    expected: expectedSettings,
    indexKey: PRODUCTS_INDEX,
  })

  logger.info(
    "[meilisearch] Synchronized index settings for 'products' and validated attributes."
  )
}
