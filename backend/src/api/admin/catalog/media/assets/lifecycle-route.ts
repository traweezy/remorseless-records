import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import {
  catalogMediaLifecycleCommandSchema,
  type CatalogMediaLifecycleCommand,
} from "@/lib/catalog/media-lifecycle"
import { readCatalogMediaAsset } from "@/lib/catalog/transaction-persistence-contracts"
import { hashCatalogCommand } from "@/modules/catalog/catalog-command"
import { serializeCatalogMediaAsset } from "@/modules/catalog/serializers"
import { mutateCatalogMediaLifecycleWorkflow } from "../../../../../workflows/catalog/mutate-media-lifecycle"
import type { CatalogService } from "../../utils"

export const runMediaLifecycleRoute = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
  command: CatalogMediaLifecycleCommand
): Promise<void> => {
  const assetId = req.params.id
  if (!assetId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Catalog media asset id is required."
    )
  }
  const actorId = req.auth_context.actor_id
  if (!actorId) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "An authenticated Admin actor is required."
    )
  }
  const parsed = catalogMediaLifecycleCommandSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "A valid catalog media lifecycle command is required."
    )
  }
  const requestSha256 = hashCatalogCommand({
    assetId,
    command,
    expectedVersion: parsed.data.expectedVersion,
  })
  await mutateCatalogMediaLifecycleWorkflow(req.scope).run({
    context: {
      idempotencyKey: parsed.data.idempotencyKey,
      requestId: parsed.data.idempotencyKey,
    },
    input: {
      actorId,
      assetId,
      command,
      expectedVersion: parsed.data.expectedVersion,
      idempotencyKey: parsed.data.idempotencyKey,
      requestSha256,
    },
  })
  const catalogService = req.scope.resolve("catalog") as CatalogService
  const asset = readCatalogMediaAsset(
    await catalogService.retrieveCatalogMediaAsset(assetId),
    assetId
  )
  res.setHeader("Cache-Control", "private, no-store")
  res.status(200).json({ asset: serializeCatalogMediaAsset(asset) })
}
