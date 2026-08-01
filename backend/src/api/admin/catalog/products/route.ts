import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"

import { catalogProductCreateSchema } from "@/lib/catalog/product-create-contract"
import { hashCatalogCommand } from "@/modules/catalog/catalog-command"
import { createCatalogProductWorkflow } from "../../../../workflows/catalog/create-product"

const actorIdFromRequest = (req: MedusaRequest): string | null =>
  (
    req as MedusaRequest & {
      auth_context?: { actor_id?: string | null }
    }
  ).auth_context?.actor_id ?? null

export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse,
): Promise<void> => {
  const parsed = catalogProductCreateSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid catalog product creation payload.",
    )
  }

  const { idempotencyKey, ...request } = parsed.data
  const commandPayload = {
    command: "catalog.product.create" as const,
    request,
  }
  const { result } = await createCatalogProductWorkflow(req.scope).run({
    context: { idempotencyKey, requestId: idempotencyKey },
    input: {
      ...parsed.data,
      actorId: actorIdFromRequest(req),
      requestSha256: hashCatalogCommand(commandPayload),
    },
  })
  res.status(result.replayed ? 200 : 201).json({
    kind: result.kind,
    productId: result.productId,
    profileId: result.profileId,
    replayed: result.replayed,
    variantIds: result.variantIds,
  })
}
