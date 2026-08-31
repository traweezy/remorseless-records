import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"

import { readCatalogMediaAsset } from "@/lib/catalog/transaction-persistence-contracts"
import { serializeCatalogMediaAsset } from "@/modules/catalog/serializers"
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
  const assetId = getAssetId(req)
  const asset = readCatalogMediaAsset(
    await catalogService.retrieveCatalogMediaAsset(assetId),
    assetId
  )

  res.status(200).json({ asset: serializeCatalogMediaAsset(asset) })
}
