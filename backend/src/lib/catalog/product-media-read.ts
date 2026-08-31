import type { Context } from "@medusajs/framework/types"
import { EntityManager } from "@medusajs/framework/mikro-orm/knex"

import type CatalogModuleService from "../../modules/catalog/service"
import { serializeCatalogProductMediaItem } from "../../modules/catalog/serializers"
import {
  readCatalogMediaAssets,
  readCatalogProductMediaItems,
  type CatalogProductMediaItemPersistenceRecord,
} from "./transaction-persistence-contracts"

type CatalogService = InstanceType<typeof CatalogModuleService>

export const listProductMediaItems = async (
  catalogService: CatalogService,
  productId: string,
  sharedContext?: Context<EntityManager>
): Promise<CatalogProductMediaItemPersistenceRecord[]> =>
  readCatalogProductMediaItems(
    await catalogService.listCatalogProductMediaItems(
      { product_id: productId },
      { order: { id: "ASC", sort_order: "ASC" }, take: 101 },
      sharedContext
    ),
    { productId },
    100
  )

export const loadProductMediaResponse = async (
  catalogService: CatalogService,
  productId: string,
  sharedContext?: Context<EntityManager>
) => {
  const items = await listProductMediaItems(
    catalogService,
    productId,
    sharedContext
  )
  const assetIds = [...new Set(items.map((item) => item.media_asset_id))]
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
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]))

  return {
    productId,
    media: items.map((item) =>
      serializeCatalogProductMediaItem(
        item,
        assetsById.get(item.media_asset_id) ?? null
      )
    ),
  }
}
