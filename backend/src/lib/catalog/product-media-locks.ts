import type { EntityManager } from "@medusajs/framework/mikro-orm/knex"
import type { Context } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"

import { toCatalogNullableString } from "./normalization"
import type {
  CatalogProductMediaInput,
  CatalogProductMediaMutationInput,
} from "./product-media-contract"
import { MAX_CATALOG_PRODUCT_MEDIA_ITEMS } from "./product-media-constraints"
import { listProductMediaItems } from "./product-media-read"
import { readCommittedCatalogProductMediaReplay } from "./product-media-replay"
import type { CatalogService } from "./reference-resolution"
import {
  readCatalogMediaAssets,
  type CatalogMediaAssetPersistenceRecord,
} from "./transaction-persistence-contracts"

export const findReusableCatalogMediaAsset = async (
  catalog: CatalogService,
  input: CatalogProductMediaInput,
  context?: Context<EntityManager>
): Promise<CatalogMediaAssetPersistenceRecord | null> => {
  const fileKey = toCatalogNullableString(input.sourceFileKey)
  const url = toCatalogNullableString(input.sourceUrl)
  if (!fileKey && !url) return null
  const matches = readCatalogMediaAssets(
    await catalog.listCatalogMediaAssets(
      fileKey
        ? { lifecycle_status: "active", source_file_key: fileKey }
        : { lifecycle_status: "active", source_url: url! },
      { take: 2 },
      context
    ),
    { maximumRows: 1 }
  )
  return matches.at(0) ?? null
}

const changed = () =>
  new MedusaError(
    MedusaError.Types.CONFLICT,
    "The catalog media changed while acquiring its locks. Refresh before saving."
  )

export const assertCatalogMediaLockCoverage = (
  required: readonly string[],
  held: readonly string[]
): void => {
  const keys = new Set(held)
  if (required.some((key) => !keys.has(key))) throw changed()
}

export const assertCatalogMediaAssetLock = (
  assetId: string,
  held: readonly string[] | undefined,
  createdAssetIds?: ReadonlySet<string>
): void => {
  // Low-level trusted callers can omit lease evidence. Workflow callers always
  // provide it; this transaction's newly inserted rows cannot be external drift.
  if (held && !createdAssetIds?.has(assetId))
    assertCatalogMediaLockCoverage([`catalog:media-asset:${assetId}`], held)
}

export const resolveCatalogProductMediaLockKeys = async (
  catalog: CatalogService,
  input:
    | { aggregateId: string; media: CatalogProductMediaInput[] }
    | CatalogProductMediaMutationInput
): Promise<string[]> => {
  if (
    !Array.isArray(input.media) ||
    input.media.length > MAX_CATALOG_PRODUCT_MEDIA_ITEMS
  )
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Too many catalog media items."
    )
  // A committed operation no longer reads or mutates current assets. Recheck
  // the same persisted binding under the Product lease before skipping plans.
  if (
    "command" in input &&
    (await readCommittedCatalogProductMediaReplay(catalog, input))
  )
    return [`catalog:product-media:${input.aggregateId}`]
  const previous = await listProductMediaItems(catalog, input.aggregateId)
  const assetIds = new Set(previous.map(({ media_asset_id }) => media_asset_id))
  for (const item of input.media) {
    const explicit = toCatalogNullableString(item.mediaAssetId)
    if (explicit) assetIds.add(explicit)
    else {
      const source = await findReusableCatalogMediaAsset(catalog, item)
      if (source) assetIds.add(source.id)
    }
  }
  if (assetIds.size > MAX_CATALOG_PRODUCT_MEDIA_ITEMS * 2) throw changed()
  return [
    `catalog:product-media:${input.aggregateId}`,
    ...[...assetIds].sort().map((id) => `catalog:media-asset:${id}`),
  ]
}
