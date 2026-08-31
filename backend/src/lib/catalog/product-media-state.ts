import { EntityManager } from "@medusajs/framework/mikro-orm/knex"
import type { Context } from "@medusajs/framework/types"

import {
  listProductMediaItems,
  loadProductMediaResponse,
} from "./product-media-read"
import type {
  CatalogMediaAssetState,
  CatalogProductMediaItemState,
  CatalogProductMediaSnapshot,
} from "./product-media-contract"
import type { CatalogService } from "./reference-resolution"
import {
  readCatalogMediaAssetMutation,
  readCatalogMediaAssets,
  readCatalogProductMediaItems,
  readCatalogProductMediaOperationResult,
  readCatalogTransactionOperationList,
  readExactCatalogProductMediaItems,
  type CatalogMediaAssetPersistenceRecord,
  type CatalogProductMediaItemPersistenceRecord,
} from "./transaction-persistence-contracts"

export const catalogMediaAssetState = (
  asset: CatalogMediaAssetPersistenceRecord
): CatalogMediaAssetState => ({
  alt_text: asset.alt_text,
  byte_size: asset.byte_size,
  caption: asset.caption,
  content_sha256: asset.content_sha256,
  crop_intent: asset.crop_intent,
  derivative_status: asset.derivative_status,
  derivatives: asset.derivatives ?? {},
  focal_x: asset.focal_x,
  focal_y: asset.focal_y,
  height: asset.height,
  id: asset.id,
  metadata: asset.metadata ?? {},
  mime_type: asset.mime_type,
  original_filename: asset.original_filename,
  source_file_key: asset.source_file_key,
  source_url: asset.source_url,
  version: asset.version,
  width: asset.width,
})

const productMediaItemState = (
  item: CatalogProductMediaItemPersistenceRecord
): CatalogProductMediaItemState => ({
  id: item.id,
  is_primary: item.is_primary,
  media_asset_id: item.media_asset_id,
  metadata: item.metadata ?? {},
  product_id: item.product_id,
  product_profile_id: item.product_profile_id,
  role: item.role,
  sort_order: item.sort_order,
  variant_id: item.variant_id,
})

export const resolveCatalogProductMediaVersion = async (
  catalogService: CatalogService,
  productId: string,
  sharedContext?: Context<EntityManager>
): Promise<number> => {
  const operation = readCatalogTransactionOperationList(
    await catalogService.listCatalogAuthoringOperations(
      {
        aggregate_id: productId,
        command: "catalog.product-media.replace",
        status: "succeeded",
      },
      { order: { created_at: "DESC", id: "DESC" }, take: 1 },
      sharedContext
    )
  )
  if (!operation) {
    return 0
  }
  if (
    operation.aggregateId !== productId ||
    operation.command !== "catalog.product-media.replace" ||
    operation.status !== "succeeded"
  ) {
    throw new Error("The catalog media version operation is inconsistent.")
  }
  return readCatalogProductMediaOperationResult(operation.result, productId)
    .version
}

export const loadCatalogProductMediaResponse = async (
  catalogService: CatalogService,
  productId: string,
  sharedContext?: Context<EntityManager>
) => ({
  ...(await loadProductMediaResponse(catalogService, productId, sharedContext)),
  version: await resolveCatalogProductMediaVersion(
    catalogService,
    productId,
    sharedContext
  ),
})

export const snapshotCatalogProductMedia = async (
  catalogService: CatalogService,
  productId: string,
  sharedContext: Context<EntityManager>
): Promise<CatalogProductMediaSnapshot> => {
  const items = await listProductMediaItems(
    catalogService,
    productId,
    sharedContext
  )
  const assetIds = [
    ...new Set(items.map(({ media_asset_id }) => media_asset_id)),
  ]
  const assets = assetIds.length
    ? readCatalogMediaAssets(
        await catalogService.listCatalogMediaAssets(
          { id: assetIds },
          { take: 101 },
          sharedContext
        ),
        {
          expectedIds: assetIds,
          maximumRows: 100,
          requireExactIds: true,
        }
      )
    : []
  return {
    assets: assets.map(catalogMediaAssetState),
    items: items.map(productMediaItemState),
  }
}

export const rememberCatalogMediaAsset = (
  snapshot: CatalogProductMediaSnapshot,
  asset: CatalogMediaAssetPersistenceRecord
): void => {
  if (!snapshot.assets.some(({ id }) => id === asset.id)) {
    snapshot.assets.push(catalogMediaAssetState(asset))
  }
}

export const restoreCatalogProductMediaSnapshot = async (
  catalogService: CatalogService,
  productId: string,
  snapshot: CatalogProductMediaSnapshot,
  sharedContext: Context<EntityManager>
): Promise<void> => {
  const currentItems = await listProductMediaItems(
    catalogService,
    productId,
    sharedContext
  )
  if (currentItems.length) {
    await catalogService.deleteCatalogProductMediaItems(
      currentItems.map(({ id }) => id),
      sharedContext
    )
  }

  if (snapshot.assets.length) {
    const expectedIds = snapshot.assets.map(({ id }) => id)
    const existingAssets = readCatalogMediaAssets(
      await catalogService.listCatalogMediaAssets(
        { id: expectedIds },
        { take: 101 },
        sharedContext
      ),
      { expectedIds, maximumRows: 100 }
    )
    const existingIds = new Set(existingAssets.map(({ id }) => id))
    const updates = snapshot.assets.filter(({ id }) => existingIds.has(id))
    const creates = snapshot.assets.filter(({ id }) => !existingIds.has(id))
    if (updates.length) {
      for (const update of updates) {
        readCatalogMediaAssetMutation(
          await catalogService.updateCatalogMediaAssets(
            [update],
            sharedContext
          ),
          update
        )
      }
    }
    if (creates.length) {
      for (const create of creates) {
        readCatalogMediaAssetMutation(
          await catalogService.createCatalogMediaAssets(
            [create],
            sharedContext
          ),
          create
        )
      }
    }
  }
  if (snapshot.items.length) {
    readExactCatalogProductMediaItems(
      await catalogService.createCatalogProductMediaItems(
        snapshot.items,
        sharedContext
      ),
      productId,
      snapshot.items
    )
  }
  readExactCatalogProductMediaItems(
    await catalogService.listCatalogProductMediaItems(
      { product_id: productId },
      { order: { id: "ASC", sort_order: "ASC" }, take: 101 },
      sharedContext
    ),
    productId,
    snapshot.items
  )
}

export const deleteCreatedMediaAssetIfOrphaned = async (
  catalogService: CatalogService,
  assetId: string,
  sharedContext: Context<EntityManager>
): Promise<void> => {
  const links = readCatalogProductMediaItems(
    await catalogService.listCatalogProductMediaItems(
      { media_asset_id: assetId },
      { take: 2 },
      sharedContext
    ),
    { mediaAssetId: assetId },
    1
  )
  if (!links.length) {
    await catalogService.deleteCatalogMediaAssets(assetId, sharedContext)
  }
}
