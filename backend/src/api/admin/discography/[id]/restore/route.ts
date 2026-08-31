import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"

import {
  discographyLifecycleSchema,
  setDiscographyEntryArchived,
  type DiscographyService,
} from "../../helpers"

export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const id = req.params.id
  const parsed = discographyLifecycleSchema.safeParse(req.body ?? {})
  if (!id || !parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "A discography entry, expected version, and idempotency key are required."
    )
  }
  const service = req.scope.resolve<DiscographyService>("discography")
  const result = await setDiscographyEntryArchived(
    req,
    service,
    id,
    parsed.data,
    false
  )
  res.status(200).json(result)
}
