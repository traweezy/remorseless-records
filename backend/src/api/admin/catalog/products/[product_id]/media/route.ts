import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"

import { assertProductExists, type CatalogService } from "../../../utils"
import {
  listProductMediaItems,
  loadProductMediaResponse,
  productMediaReplaceSchema,
  replaceProductMedia,
} from "../../../media/helpers"

const getProductId = (req: MedusaRequest): string => {
  const productId = req.params.product_id
  if (!productId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Product id is required"
    )
  }

  return productId
}

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const productId = getProductId(req)
  await assertProductExists(req, productId)
  const catalogService = req.scope.resolve("catalog") as CatalogService
  res.status(200).json(await loadProductMediaResponse(catalogService, productId))
}

export const PUT = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const parsed = productMediaReplaceSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid catalog product media payload"
    )
  }

  const productId = getProductId(req)
  await assertProductExists(req, productId)
  const catalogService = req.scope.resolve("catalog") as CatalogService
  res
    .status(200)
    .json(
      await replaceProductMedia(req, catalogService, productId, parsed.data.media)
    )
}

export const DELETE = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const productId = getProductId(req)
  const catalogService = req.scope.resolve("catalog") as CatalogService
  const items = await listProductMediaItems(catalogService, productId)
  const ids = items.map((item) => item.id)
  if (ids.length) {
    await catalogService.deleteCatalogProductMediaItems(ids)
  }

  res.sendStatus(204)
}
