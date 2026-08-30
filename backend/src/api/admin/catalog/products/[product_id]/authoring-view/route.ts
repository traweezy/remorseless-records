import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"

import { loadProductAuthoringView } from "../../../../../../lib/catalog/product-authoring-view"

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const productId = req.params.product_id?.trim()
  if (!productId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Product id is required."
    )
  }

  const view = await loadProductAuthoringView(req.scope, productId)
  res.setHeader("Cache-Control", "private, no-store")
  res.status(200).json({ view })
}
