import type { Context } from "@medusajs/framework/types"
import { EntityManager } from "@medusajs/framework/mikro-orm/knex"

import type CatalogModuleService from "../../modules/catalog/service"
import {
  serializeCatalogProductMediaItem,
  type CatalogMediaAssetRecord,
  type CatalogProductMediaItemRecord,
} from "../../modules/catalog/serializers"

type CatalogService = InstanceType<typeof CatalogModuleService>

export const listProductMediaItems = async (
  catalogService: CatalogService,
  productId: string,
  sharedContext?: Context<EntityManager>,
): Promise<CatalogProductMediaItemRecord[]> =>
  (await catalogService.listCatalogProductMediaItems(
    { product_id: productId },
    { order: { sort_order: "ASC" } },
    sharedContext,
  )) as CatalogProductMediaItemRecord[]

export const loadProductMediaResponse = async (
  catalogService: CatalogService,
  productId: string,
  sharedContext?: Context<EntityManager>,
) => {
  const items = await listProductMediaItems(
    catalogService,
    productId,
    sharedContext,
  )
  const assetIds = [...new Set(items.map((item) => item.media_asset_id))]
  const assets = assetIds.length
    ? ((await catalogService.listCatalogMediaAssets(
        { id: assetIds },
        {},
        sharedContext,
      )) as CatalogMediaAssetRecord[])
    : []
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]))

  return {
    productId,
    media: items.map((item) =>
      serializeCatalogProductMediaItem(
        item,
        assetsById.get(item.media_asset_id) ?? null,
      ),
    ),
  }
}
