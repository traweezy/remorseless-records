import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"

import type NewsModuleService from "@/modules/news/service"
import {
  newsLifecycleSchema,
  setNewsEntryArchived,
} from "../../helpers"

type NewsService = InstanceType<typeof NewsModuleService>

export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const parsed = newsLifecycleSchema.safeParse(req.body ?? {})
  const id = req.params.id
  if (!parsed.success || !id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "A news post, expected version, and idempotency key are required."
    )
  }
  const service = req.scope.resolve("news") as NewsService
  const result = await setNewsEntryArchived(
    req,
    service,
    id,
    parsed.data,
    true
  )
  res.status(200).json(result)
}
