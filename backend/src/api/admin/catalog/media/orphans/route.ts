import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"

import {
  serializeCatalogMediaAsset,
  type CatalogMediaAssetRecord,
  type CatalogProductMediaItemRecord,
} from "@/modules/catalog/serializers"
import type { CatalogService } from "../../utils"

const toLimit = (value: unknown): number => {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = typeof raw === "string" ? Number.parseInt(raw, 10) : NaN
  if (!Number.isFinite(parsed)) {
    return 200
  }
  return Math.min(Math.max(parsed, 1), 500)
}

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const catalogService = req.scope.resolve("catalog") as CatalogService
  const limit = toLimit(req.query?.limit)
  const assets = (await catalogService.listCatalogMediaAssets(
    {},
    { take: limit, order: { created_at: "DESC" } }
  )) as CatalogMediaAssetRecord[]
  const links = (await catalogService.listCatalogProductMediaItems(
    {},
    { take: 10_000 }
  )) as CatalogProductMediaItemRecord[]
  const linkedAssetIds = new Set(links.map((link) => link.media_asset_id))
  const orphanAssets = assets.filter((asset) => !linkedAssetIds.has(asset.id))

  res.status(200).json({
    count: orphanAssets.length,
    assets: orphanAssets.map(serializeCatalogMediaAsset),
  })
}
