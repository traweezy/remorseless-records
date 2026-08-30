import { EntityManager } from "@medusajs/framework/mikro-orm/knex"
import type { Context } from "@medusajs/framework/types"

import {
  catalogMediaDerivativeStatusValues,
  catalogMediaRoleValues,
  type CatalogMediaAssetRecord,
  type CatalogMediaDerivativeStatus,
  type CatalogMediaRole,
  type CatalogProductMediaItemRecord,
} from "../../modules/catalog/serializers"
import { coerceCatalogJsonRecord } from "./normalization"
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

const toMediaDerivativeStatus = (
  value: unknown
): CatalogMediaDerivativeStatus =>
  catalogMediaDerivativeStatusValues.find((status) => status === value) ??
  "source_only"

const toMediaRole = (value: unknown): CatalogMediaRole =>
  catalogMediaRoleValues.find((role) => role === value) ?? "gallery"

export const catalogMediaAssetState = (
  asset: CatalogMediaAssetRecord
): CatalogMediaAssetState => ({
  alt_text: asset.alt_text,
  byte_size: asset.byte_size,
  caption: asset.caption,
  content_sha256: asset.content_sha256,
  crop_intent: asset.crop_intent,
  derivative_status: toMediaDerivativeStatus(asset.derivative_status),
  derivatives: coerceCatalogJsonRecord(asset.derivatives),
  focal_x: asset.focal_x,
  focal_y: asset.focal_y,
  height: asset.height,
  id: asset.id,
  metadata: coerceCatalogJsonRecord(asset.metadata),
  mime_type: asset.mime_type,
  original_filename: asset.original_filename,
  source_file_key: asset.source_file_key,
  source_url: asset.source_url,
  version: asset.version,
  width: asset.width,
})

const productMediaItemState = (
  item: CatalogProductMediaItemRecord
): CatalogProductMediaItemState => ({
  id: item.id,
  is_primary: item.is_primary,
  media_asset_id: item.media_asset_id,
  metadata: coerceCatalogJsonRecord(item.metadata),
  product_id: item.product_id,
  product_profile_id: item.product_profile_id,
  role: toMediaRole(item.role),
  sort_order: item.sort_order,
  variant_id: item.variant_id,
})

export const resolveCatalogProductMediaVersion = async (
  catalogService: CatalogService,
  productId: string,
  sharedContext?: Context<EntityManager>
): Promise<number> => {
  const operations = await catalogService.listCatalogAuthoringOperations(
    {
      aggregate_id: productId,
      command: "catalog.product-media.replace",
      status: "succeeded",
    },
    { order: { created_at: "DESC" }, take: 100 },
    sharedContext
  )
  return operations.reduce((version, operation) => {
    const result = coerceCatalogJsonRecord(operation.result)
    const resultVersion =
      typeof result.version === "number"
        ? result.version
        : operation.expected_version + 1
    return Math.max(version, resultVersion)
  }, 0)
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
  const items = (await listProductMediaItems(
    catalogService,
    productId,
    sharedContext
  )) as CatalogProductMediaItemRecord[]
  const assetIds = [
    ...new Set(items.map(({ media_asset_id }) => media_asset_id)),
  ]
  const assets = assetIds.length
    ? ((await catalogService.listCatalogMediaAssets(
        { id: assetIds },
        {},
        sharedContext
      )) as CatalogMediaAssetRecord[])
    : []
  return {
    assets: assets.map(catalogMediaAssetState),
    items: items.map(productMediaItemState),
  }
}

export const rememberCatalogMediaAsset = (
  snapshot: CatalogProductMediaSnapshot,
  asset: CatalogMediaAssetRecord
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
    const existingAssets = await catalogService.listCatalogMediaAssets(
      { id: snapshot.assets.map(({ id }) => id) },
      {},
      sharedContext
    )
    const existingIds = new Set(existingAssets.map(({ id }) => id))
    const updates = snapshot.assets.filter(({ id }) => existingIds.has(id))
    const creates = snapshot.assets.filter(({ id }) => !existingIds.has(id))
    if (updates.length) {
      await catalogService.updateCatalogMediaAssets(
        updates as never,
        sharedContext
      )
    }
    if (creates.length) {
      await catalogService.createCatalogMediaAssets(
        creates as never,
        sharedContext
      )
    }
  }
  if (snapshot.items.length) {
    await catalogService.createCatalogProductMediaItems(
      snapshot.items as never,
      sharedContext
    )
  }
}

export const deleteCreatedMediaAssetIfOrphaned = async (
  catalogService: CatalogService,
  assetId: string,
  sharedContext: Context<EntityManager>
): Promise<void> => {
  const links = await catalogService.listCatalogProductMediaItems(
    { media_asset_id: assetId },
    { take: 1 },
    sharedContext
  )
  if (!links.length) {
    await catalogService.deleteCatalogMediaAssets(assetId, sharedContext)
  }
}
