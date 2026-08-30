import { createHash } from "node:crypto"

import {
  isTaxCollectionMode,
  isTaxProviderName,
  type TaxCollectionMode,
  type TaxProviderName,
} from "../../modules/tax-control/constants"

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

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null

const positiveInteger = (value: unknown): number | null => {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

const optionalFiniteNumber = (value: unknown): number | undefined => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

const taxCodesFrom = (value: unknown): Record<string, string> => {
  const record = asRecord(value)
  if (!record) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string] =>
        /^.+$/.test(entry[0]) &&
        typeof entry[1] === "string" &&
        /^txcd_\d{8}$/.test(entry[1])
    )
  )
}

const minorUnitAmountsFrom = (value: unknown): Record<string, number> => {
  const record = asRecord(value)
  if (!record) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(record)
      .map(([key, amount]) => [key, Number(amount)] as const)
      .filter(
        (entry): entry is readonly [string, number] =>
          Boolean(entry[0]) && Number.isSafeInteger(entry[1]) && entry[1] >= 0
      )
  )
}

const finiteNumbersFrom = (value: unknown): Record<string, number> => {
  const record = asRecord(value)
  if (!record) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(record)
      .map(([key, number]) => [key, Number(number)] as const)
      .filter(
        (entry): entry is readonly [string, number] =>
          Boolean(entry[0]) && Number.isFinite(entry[1]) && entry[1] >= 0
      )
  )
}

const frozenQuoteFrom = (value: unknown): FrozenTaxQuote | undefined => {
  const record = asRecord(value)
  if (!record) {
    return undefined
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
    return undefined
  }

  const stripeCalculationId =
    typeof record.stripeCalculationId === "string" &&
    /^taxcalc_[A-Za-z0-9]+$/.test(record.stripeCalculationId)
      ? record.stripeCalculationId
      : undefined
  const taxRatePercent = optionalFiniteNumber(record.taxRatePercent)

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
  const shippingAmountMinor = Number(record.shippingAmountMinor ?? 0)
  if (
    !collectionMode ||
    !generation ||
    !subjectId ||
    !fingerprint ||
    (collectionMode === "collect" && !provider) ||
    (collectionMode === "disabled" && provider !== null) ||
    !Number.isSafeInteger(shippingAmountMinor) ||
    shippingAmountMinor < 0
  ) {
    throw new Error("Tax provider control context is invalid.")
  }

  const frozenQuote = frozenQuoteFrom(record.frozenQuote)
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
    itemAmountsMinor: minorUnitAmountsFrom(record.itemAmountsMinor),
    itemTaxCodes: taxCodesFrom(record.itemTaxCodes),
    preservedItemRates: finiteNumbersFrom(record.preservedItemRates),
    preservedShippingRates: finiteNumbersFrom(record.preservedShippingRates),
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
