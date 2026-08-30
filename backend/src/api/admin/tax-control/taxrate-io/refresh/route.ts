import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import type { ILockingModule, Logger } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"

import {
  TAX_RATE_LOOKUP_API_KEY,
  TAX_RATE_LOOKUP_MONITOR_POSTAL_CODE,
} from "../../../../../lib/constants"
import {
  persistTaxRateIoQuota,
  writeTaxRateIoQuotaToRedis,
} from "../../../../../lib/tax-control/quota"
import type TaxControlModuleService from "../../../../../modules/tax-control/service"
import { fetchTaxRateIo } from "../../../../../modules/tax-rate-provider/clients/taxrate-io"
import { taxControlSnapshot } from "../../utils"

const REFRESH_LOCK = "tax-control:taxrate-io:quota-refresh"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  if (!req.auth_context?.actor_id) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "An authenticated admin user is required."
    )
  }
  const postalCode = TAX_RATE_LOOKUP_MONITOR_POSTAL_CODE?.trim()
  if (!postalCode || !/^\d{5}(?:-\d{4})?$/.test(postalCode)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "A reviewed TAX_RATE_LOOKUP_MONITOR_POSTAL_CODE is required for manual quota checks."
    )
  }
  if (!TAX_RATE_LOOKUP_API_KEY.trim()) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "TaxRate.io is not configured."
    )
  }

  const service = req.scope.resolve<TaxControlModuleService>("tax_control")
  const locking = req.scope.resolve<ILockingModule>(Modules.LOCKING)
  const logger = req.scope.resolve<Logger>("logger")
  await locking.execute(
    REFRESH_LOCK,
    async () => {
      const result = await fetchTaxRateIo({
        apiKey: TAX_RATE_LOOKUP_API_KEY,
        onRetry: ({ attempt, reason, totalAttempts }) =>
          logger.warn(
            `Tax rate quota refresh retry scheduled (${reason}, attempt ${attempt}/${totalAttempts}).`
          ),
        timeoutMs: 8_000,
        zip: postalCode,
      })
      if (!result.quota) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "TaxRate.io did not return quota usage."
        )
      }
      await Promise.all([
        persistTaxRateIoQuota({
          quota: result.quota,
          service,
          source: "manual_refresh",
        }),
        writeTaxRateIoQuotaToRedis(logger, result.quota),
      ])
    },
    { timeout: 5 }
  )

  res.setHeader("Cache-Control", "no-store")
  res.status(200).json(await taxControlSnapshot(req.scope))
}
