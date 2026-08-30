import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"

import type { CatalogService } from "../../../utils"
import { setShelfArchived, shelfLifecycleSchema } from "../../helpers"
import { emitCatalogShelfChanged } from "../../events"

const getShelfId = (req: MedusaRequest): string => {
  const id = req.params.id
  if (!id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Catalog shelf id is required"
    )
  }
  return id
}

export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const parsed = shelfLifecycleSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid catalog shelf restore payload"
    )
  }
  const catalogService = req.scope.resolve("catalog") as CatalogService
  const shelfId = getShelfId(req)
  const result = await setShelfArchived(
    req,
    catalogService,
    shelfId,
    parsed.data,
    false
  )
  await emitCatalogShelfChanged(req, shelfId)
  res.status(200).json(result)
}
