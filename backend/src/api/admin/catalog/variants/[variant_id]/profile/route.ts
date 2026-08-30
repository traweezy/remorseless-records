import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"

import {
  catalogVariantProfileUpsertSchema,
  resolveCatalogVariantProfile,
  serializeCatalogVariantProfileResponse,
} from "@/lib/catalog/variant-profile-authoring"
import { rejectCatalogHardDeletion } from "@/lib/catalog/hard-deletion"
import { hashCatalogCommand } from "@/modules/catalog/catalog-command"
import { mutateCatalogVariantProfileWorkflow } from "../../../../../../workflows/catalog/mutate-variant-profile"
import { assertVariantExists, type CatalogService } from "../../../utils"

const variantIdFromRequest = (req: MedusaRequest): string => {
  const variantId = req.params.variant_id?.trim()
  if (!variantId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Product variant id is required."
    )
  }
  return variantId
}

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const variantId = variantIdFromRequest(req)
  await assertVariantExists(req, variantId)
  const catalogService = req.scope.resolve("catalog") as CatalogService
  const profile = await resolveCatalogVariantProfile(catalogService, variantId)
  res.status(200).json(serializeCatalogVariantProfileResponse(profile))
}

export const PUT = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const variantId = variantIdFromRequest(req)
  const parsed = catalogVariantProfileUpsertSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid catalog variant profile payload."
    )
  }

  await assertVariantExists(req, variantId)
  const catalogService = req.scope.resolve("catalog") as CatalogService
  const actorId =
    (
      req as MedusaRequest & {
        auth_context?: { actor_id?: string | null }
      }
    ).auth_context?.actor_id ?? null
  const { expectedVersion, idempotencyKey, ...patch } = parsed.data
  const requestSha256 = hashCatalogCommand({
    command: "catalog.variant-profile.upsert",
    input: { expectedVersion, ...patch },
    variantId,
  })
  const { result } = await mutateCatalogVariantProfileWorkflow(req.scope).run({
    context: {
      idempotencyKey,
      requestId: idempotencyKey,
    },
    input: {
      actorId,
      aggregateId: variantId,
      command: "catalog.variant-profile.upsert",
      expectedVersion,
      idempotencyKey,
      patch,
      requestSha256,
    },
  })
  const profile = await resolveCatalogVariantProfile(catalogService, variantId)
  res
    .status(result.created ? 201 : 200)
    .json(serializeCatalogVariantProfileResponse(profile))
}

export const DELETE = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> =>
  rejectCatalogHardDeletion(req, res, "catalog variant profiles")
