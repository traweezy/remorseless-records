import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import type { ICurrencyModuleService } from "@medusajs/framework/types"
import {
  MedusaError,
  Modules,
  normalizeCurrencyCode,
} from "@medusajs/framework/utils"

import { asUnknownRecord } from "../provider-boundary/records"

const invalid: () => never = () => {
  throw new MedusaError(
    MedusaError.Types.INVALID_DATA,
    "Choose a currency from the native currency catalog."
  )
}
const inconsistent: () => never = () => {
  throw new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    "The native currency catalog returned inconsistent currency data."
  )
}

// The exact native POST registrations validate and authorize before this read.
// Currency is a separate module: this lookup does not claim atomicity against
// trusted out-of-band catalog mutation, and never uses a cached/static fallback.
export const enforceNativeRegionCurrency = async (
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
): Promise<void> => {
  const body = asUnknownRecord(req.validatedBody) ?? invalid()
  if (body.currency_code === undefined) {
    next()
    return
  }
  if (typeof body.currency_code !== "string") invalid()
  // Preserve native normalization (lowercase only), including its rejection of
  // unknown whitespace-bearing codes. The original validated body is untouched.
  const code = normalizeCurrencyCode(body.currency_code)
  if (!code.length) invalid()
  const currency = req.scope.resolve<ICurrencyModuleService>(Modules.CURRENCY)
  const rows: unknown = await currency.listCurrencies(
    { code: [code] },
    { select: ["code"], take: 2 }
  )
  if (!Array.isArray(rows)) inconsistent()
  if (!rows.length) invalid()
  if (rows.length !== 1 || asUnknownRecord(rows[0])?.code !== code)
    inconsistent()
  next()
}
