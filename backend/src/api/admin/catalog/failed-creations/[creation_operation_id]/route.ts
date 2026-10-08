import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import {
  failedCreationRepairIdentitySchema,
  inspectFailedCatalogCreation,
  repairFailedCatalogCreation,
} from "@/lib/catalog/failed-creation-repair"
import { verifyFailedCreationRepairTarget } from "@/lib/catalog/failed-creation-repair-target"
import {
  failedCreationApplyBodySchema,
  failedCreationPreviewQuerySchema,
} from "./dto"

const actor = (req: AuthenticatedMedusaRequest): string => {
  const context = req.auth_context
  if (
    context?.actor_type !== "user" ||
    typeof context.actor_id !== "string" ||
    !/^user_[A-Za-z0-9_-]{1,248}$/u.test(context.actor_id)
  )
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "An authenticated Admin user is required for failed-creation repair."
    )
  return context.actor_id
}

const verifyTarget = (sha: string): void => {
  try {
    verifyFailedCreationRepairTarget(process.env, sha)
  } catch {
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      "Failed-creation repair requires the exact deployed staging Backend target."
    )
  }
}

const identity = (req: AuthenticatedMedusaRequest, productId: string) => {
  const parsed = failedCreationRepairIdentitySchema.safeParse({
    creationOperationId: req.params.creation_operation_id,
    productId,
  })
  if (!parsed.success)
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "A valid failed-creation operation and Product identity are required."
    )
  return parsed.data
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  res.setHeader("Cache-Control", "private, no-store")
  const actorId = actor(req)
  const parsed = failedCreationPreviewQuerySchema.safeParse(req.query)
  if (!parsed.success)
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "A valid exact-SHA failed-creation preview query is required."
    )
  const input = identity(req, parsed.data.productId)
  verifyTarget(parsed.data.sha)
  const preview = await inspectFailedCatalogCreation(req.scope, input)
  res.status(200).json({ ...preview, actorId })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  res.setHeader("Cache-Control", "private, no-store")
  const actorId = actor(req)
  const parsed = failedCreationApplyBodySchema.safeParse(req.body)
  if (!parsed.success)
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "A reviewed manifest, new repair UUID and exact deployed SHA are required."
    )
  const { sha, expectedActorId, ...command } = parsed.data
  if (expectedActorId !== actorId)
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      "The authenticated Admin user changed after the failed-creation preview."
    )
  const input = { ...command, ...identity(req, command.productId) }
  verifyTarget(sha)
  // The existing request scope is already initialized. Do not launch exec,
  // reload modules/providers, or accept audit authority from request data.
  const repaired = await repairFailedCatalogCreation(req.scope, input, {
    actorId,
    source: "admin_http",
  })
  res.status(200).json(repaired)
}
