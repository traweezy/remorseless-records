import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import type { ILockingModule, Logger } from "@medusajs/framework/types"
import { z } from "@medusajs/framework/zod"
import { MedusaError, Modules } from "@medusajs/framework/utils"

import {
  resolveStripeTaxReadiness,
  resolveTaxRateIoReadiness,
} from "../../../../lib/tax-control/readiness"
import { syncTaxRateIoQuota } from "../../../../lib/tax-control/quota"
import {
  TAX_CONTROL_ACKNOWLEDGEMENT_VERSION,
  TAX_CONTROL_LOCK_KEY,
  TAX_DISABLED_ACKNOWLEDGEMENT,
  taxCollectionModes,
  taxProviderNames,
} from "../../../../modules/tax-control/constants"
import type TaxControlModuleService from "../../../../modules/tax-control/service"
import { taxControlSnapshot } from "../utils"

const transitionFields = {
  expectedGeneration: z.number().int().positive(),
  idempotencyKey: z.string().uuid(),
  reason: z.string().trim().min(10).max(500),
  targetProvider: z.enum(taxProviderNames),
} as const

const switchSchema = z.discriminatedUnion("targetCollectionMode", [
  z
    .object({
      ...transitionFields,
      acknowledgement: z.literal(TAX_DISABLED_ACKNOWLEDGEMENT),
      targetCollectionMode: z.literal(taxCollectionModes[1]),
    })
    .strict(),
  z
    .object({
      ...transitionFields,
      targetCollectionMode: z.literal(taxCollectionModes[0]),
    })
    .strict(),
])

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const parsed = switchSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Provide a collection choice, target provider, current generation, reason, idempotency key, and the exact acknowledgement when disabling tax."
    )
  }
  const actorId = req.auth_context?.actor_id
  if (!actorId) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "An authenticated admin user is required."
    )
  }

  const service = req.scope.resolve<TaxControlModuleService>("tax_control")
  const locking = req.scope.resolve<ILockingModule>(Modules.LOCKING)
  const logger = req.scope.resolve<Logger>("logger")
  await locking.execute(
    TAX_CONTROL_LOCK_KEY,
    async () => {
      if (parsed.data.targetCollectionMode === "collect") {
        const quota =
          parsed.data.targetProvider === "taxrate_io"
            ? await syncTaxRateIoQuota({ logger, service })
            : null
        const remaining = quota?.remaining ?? null
        const readiness =
          parsed.data.targetProvider === "stripe_tax"
            ? await resolveStripeTaxReadiness({ logger })
            : resolveTaxRateIoReadiness(remaining)
        if (!readiness.ready) {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            `${parsed.data.targetProvider} is not ready: ${readiness.message}`
          )
        }
      }

      await service.transitionTaxControl({
        acknowledgementVersion: TAX_CONTROL_ACKNOWLEDGEMENT_VERSION,
        actorId,
        expectedGeneration: parsed.data.expectedGeneration,
        idempotencyKey: parsed.data.idempotencyKey,
        reason: parsed.data.reason,
        targetCollectionMode: parsed.data.targetCollectionMode,
        targetProvider: parsed.data.targetProvider,
      })
    },
    { timeout: 5 }
  )

  res.setHeader("Cache-Control", "no-store")
  res.status(200).json(await taxControlSnapshot(req.scope))
}
