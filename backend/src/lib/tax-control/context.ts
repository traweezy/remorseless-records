import { createHash } from "node:crypto"

import {
  isTaxCollectionMode,
  isTaxProviderName,
  type TaxCollectionMode,
  type TaxProviderName,
} from "../../modules/tax-control/constants"
import {
  readFiniteNumber,
  readNonNegativeSafeInteger,
} from "../provider-boundary/primitives"
import { asUnknownRecord as asRecord } from "../provider-boundary/records"

export const TAX_CONTEXT_KEY = "remorseless_tax"
export const TAX_LINE_CODE_PREFIX = "rr_tax"

export type FrozenTaxQuote = {
  collectionMode: TaxCollectionMode
  generation: number
  provider: TaxProviderName | null
  stripeCalculationId?: string
  taxRatePercent?: number
}

export type TaxControlContext = {
  collectionMode: TaxCollectionMode
  fingerprint: string
  frozenQuote?: FrozenTaxQuote
  generation: number
  itemAmountsMinor: Record<string, number>
  itemTaxCodes: Record<string, string>
  preservedItemRates: Record<string, number>
  preservedShippingRates: Record<string, number>
  provider: TaxProviderName | null
  shippingAmountMinor: number
  subjectId: string
}

const positiveInteger = (value: unknown): number | null => {
  const parsed = readNonNegativeSafeInteger(value)
  return parsed !== null && parsed > 0 ? parsed : null
}

const optionalFiniteNumber = (value: unknown): number | null | undefined => {
  if (value === null || value === undefined) {
    return undefined
  }
  const parsed = readFiniteNumber(value)
  return parsed !== null && parsed >= 0 ? parsed : null
}

const taxCodesFrom = (value: unknown): Record<string, string> | null => {
  if (value === null || value === undefined) {
    return {}
  }
  const record = asRecord(value)
  if (!record) {
    return null
  }

  const entries: Array<[string, string]> = []
  for (const [key, code] of Object.entries(record)) {
    if (!key || typeof code !== "string" || !/^txcd_\d{8}$/.test(code)) {
      return null
    }
    entries.push([key, code])
  }
  return Object.fromEntries(entries)
}

const minorUnitAmountsFrom = (
  value: unknown
): Record<string, number> | null => {
  if (value === null || value === undefined) {
    return {}
  }
  const record = asRecord(value)
  if (!record) {
    return null
  }

  const entries: Array<[string, number]> = []
  for (const [key, amount] of Object.entries(record)) {
    const parsed = readNonNegativeSafeInteger(amount)
    if (!key || parsed === null) {
      return null
    }
    entries.push([key, parsed])
  }
  return Object.fromEntries(entries)
}

const finiteNumbersFrom = (value: unknown): Record<string, number> | null => {
  if (value === null || value === undefined) {
    return {}
  }
  const record = asRecord(value)
  if (!record) {
    return null
  }

  const entries: Array<[string, number]> = []
  for (const [key, number] of Object.entries(record)) {
    const parsed = readFiniteNumber(number)
    if (!key || parsed === null || parsed < 0) {
      return null
    }
    entries.push([key, parsed])
  }
  return Object.fromEntries(entries)
}

const frozenQuoteFrom = (value: unknown): FrozenTaxQuote | null | undefined => {
  if (value === null || value === undefined) {
    return undefined
  }
  const record = asRecord(value)
  if (!record) {
    return null
  }

  const collectionMode = isTaxCollectionMode(record.collectionMode)
    ? record.collectionMode
    : isTaxProviderName(record.provider)
      ? "collect"
      : null
  const provider = isTaxProviderName(record.provider) ? record.provider : null
  const generation = positiveInteger(record.generation)
  if (
    !collectionMode ||
    !generation ||
    (collectionMode === "collect" && !provider) ||
    (collectionMode === "disabled" && provider !== null)
  ) {
    return null
  }

  const stripeCalculationIdValue = record.stripeCalculationId
  const stripeCalculationId =
    typeof record.stripeCalculationId === "string" &&
    /^taxcalc_[A-Za-z0-9]+$/.test(record.stripeCalculationId)
      ? record.stripeCalculationId
      : undefined
  const taxRatePercent = optionalFiniteNumber(record.taxRatePercent)
  if (
    (stripeCalculationIdValue !== null &&
      stripeCalculationIdValue !== undefined &&
      !stripeCalculationId) ||
    taxRatePercent === null
  ) {
    return null
  }

  return {
    collectionMode,
    generation,
    provider,
    ...(stripeCalculationId ? { stripeCalculationId } : {}),
    ...(taxRatePercent !== undefined ? { taxRatePercent } : {}),
  }
}

export const parseTaxControlContext = (
  additionalContext: Record<string, unknown> | undefined
): TaxControlContext => {
  const record = asRecord(additionalContext?.[TAX_CONTEXT_KEY])
  if (!record) {
    throw new Error("Tax provider control context is missing.")
  }

  const collectionMode = isTaxCollectionMode(record.collectionMode)
    ? record.collectionMode
    : isTaxProviderName(record.provider)
      ? "collect"
      : null
  const provider = isTaxProviderName(record.provider) ? record.provider : null

  const generation = positiveInteger(record.generation)
  const subjectId =
    typeof record.subjectId === "string" && record.subjectId.trim()
      ? record.subjectId.trim()
      : null
  const fingerprint =
    typeof record.fingerprint === "string" &&
    /^[A-Za-z0-9_-]{32,128}$/.test(record.fingerprint)
      ? record.fingerprint
      : null
  const shippingAmountMinor = readNonNegativeSafeInteger(
    record.shippingAmountMinor ?? 0
  )
  const itemAmountsMinor = minorUnitAmountsFrom(record.itemAmountsMinor)
  const itemTaxCodes = taxCodesFrom(record.itemTaxCodes)
  const preservedItemRates = finiteNumbersFrom(record.preservedItemRates)
  const preservedShippingRates = finiteNumbersFrom(
    record.preservedShippingRates
  )
  if (
    !collectionMode ||
    !generation ||
    !subjectId ||
    !fingerprint ||
    (collectionMode === "collect" && !provider) ||
    (collectionMode === "disabled" && provider !== null) ||
    shippingAmountMinor === null ||
    itemAmountsMinor === null ||
    itemTaxCodes === null ||
    preservedItemRates === null ||
    preservedShippingRates === null
  ) {
    throw new Error("Tax provider control context is invalid.")
  }

  const frozenQuote = frozenQuoteFrom(record.frozenQuote)
  if (frozenQuote === null) {
    throw new Error("Tax provider control context is invalid.")
  }
  if (
    frozenQuote &&
    (frozenQuote.collectionMode !== collectionMode ||
      frozenQuote.provider !== provider ||
      frozenQuote.generation !== generation)
  ) {
    throw new Error("Frozen tax quote does not match its provider generation.")
  }

  return {
    fingerprint,
    collectionMode,
    generation,
    itemAmountsMinor,
    itemTaxCodes,
    preservedItemRates,
    preservedShippingRates,
    provider,
    shippingAmountMinor,
    subjectId,
    ...(frozenQuote ? { frozenQuote } : {}),
  }
}

export const createTaxContextFingerprint = (
  value: Record<string, unknown>
): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("base64url")

export const buildTaxLineCode = ({
  calculationId,
  collectionMode,
  generation,
  provider,
}: {
  calculationId?: string
  collectionMode: TaxCollectionMode
  generation: number
  provider: TaxProviderName | null
}): string =>
  [
    TAX_LINE_CODE_PREFIX,
    collectionMode === "disabled" ? "disabled" : provider,
    `g${generation}`,
    collectionMode === "disabled" ? "decision" : (calculationId ?? "quote"),
  ].join(":")

export type TaxLineIdentity = {
  calculationId: string | null
  collectionMode: TaxCollectionMode
  generation: number
  provider: TaxProviderName | null
}

export const parseTaxLineCode = (value: unknown): TaxLineIdentity | null => {
  if (typeof value !== "string") {
    return null
  }

  const [prefix, identity, generationValue, calculationId, ...rest] =
    value.split(":")
  const collectionMode = identity === "disabled" ? "disabled" : "collect"
  const provider = isTaxProviderName(identity) ? identity : null
  if (
    rest.length ||
    prefix !== TAX_LINE_CODE_PREFIX ||
    (collectionMode === "collect" && !provider) ||
    (collectionMode === "disabled" && calculationId !== "decision") ||
    !generationValue?.startsWith("g")
  ) {
    return null
  }

  const generation = positiveInteger(generationValue.slice(1))
  if (!generation) {
    return null
  }

  return {
    calculationId:
      collectionMode === "collect" &&
      calculationId &&
      /^taxcalc_[A-Za-z0-9]+$/.test(calculationId)
        ? calculationId
        : null,
    collectionMode,
    generation,
    provider,
  }
}
