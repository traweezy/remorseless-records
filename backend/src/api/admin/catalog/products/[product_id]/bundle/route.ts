import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"

import {
  bundleUpsertSchema,
  deleteBundleForProduct,
  resolveBundleProfile,
  serializeBundleResponse,
  upsertBundleForProduct,
} from "../../../bundles/helpers"
import { assertProductExists, type CatalogService } from "../../../utils"

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const productId = req.params.product_id
  if (!productId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Product id is required"
    )
  }

  await assertProductExists(req, productId)
  const catalogService = req.scope.resolve("catalog") as CatalogService
  const bundle = await resolveBundleProfile(catalogService, productId)
  res.status(200).json(await serializeBundleResponse(catalogService, bundle))
}

export const PUT = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const productId = req.params.product_id
  if (!productId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Product id is required"
    )
  }

  const parsed = bundleUpsertSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid catalog bundle payload"
    )
  }

  const catalogService = req.scope.resolve("catalog") as CatalogService
  const result = await upsertBundleForProduct(
    req,
    catalogService,
    productId,
    parsed.data
  )
  res.status(result.status).json(result.body)
}

export const DELETE = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const productId = req.params.product_id
  if (!productId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Product id is required"
    )
  }

  const catalogService = req.scope.resolve("catalog") as CatalogService
  await deleteBundleForProduct(catalogService, productId)
  res.sendStatus(204)
}
