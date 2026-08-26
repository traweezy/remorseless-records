import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"

import {
  serializeCatalogMediaAsset,
  type CatalogMediaAssetRecord,
} from "@/modules/catalog/serializers"
import type { CatalogService } from "../../../utils"

const getAssetId = (req: MedusaRequest): string => {
  const assetId = req.params.id
  if (!assetId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Catalog media asset id is required"
    )
  }

  return assetId
}

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const catalogService = req.scope.resolve("catalog") as CatalogService
  const asset = (await catalogService.retrieveCatalogMediaAsset(
    getAssetId(req)
  )) as CatalogMediaAssetRecord

  res.status(200).json({ asset: serializeCatalogMediaAsset(asset) })
}
