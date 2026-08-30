import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import { inspectCatalogProductCreation } from "@/lib/catalog/product-create-authoring"
import type CatalogModuleService from "@/modules/catalog/service"

type CatalogService = InstanceType<typeof CatalogModuleService>

const idempotencyKeySchema = z.string().uuid()

const actorIdFromRequest = (req: MedusaRequest): string | null =>
  (
    req as MedusaRequest & {
      auth_context?: { actor_id?: string | null }
    }
  ).auth_context?.actor_id ?? null

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const parsed = idempotencyKeySchema.safeParse(req.params.idempotency_key)
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid catalog product creation idempotency key."
    )
  }

  const catalogService = req.scope.resolve("catalog") as CatalogService
  const state = await inspectCatalogProductCreation(
    catalogService,
    actorIdFromRequest(req),
    parsed.data
  )
  res.setHeader("Cache-Control", "no-store")
  res.status(200).json({ state })
}
