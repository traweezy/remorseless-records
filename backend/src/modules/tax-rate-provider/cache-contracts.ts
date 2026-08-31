import {
  readFiniteNumber,
  readIsoTimestamp,
  readNonNegativeSafeInteger,
} from "../../lib/provider-boundary/primitives"
import { asUnknownRecord } from "../../lib/provider-boundary/records"
import type { StripeTaxCalculationResult } from "./clients/stripe-tax"
import type {
  TaxRateIoJurisdiction,
  TaxRateIoQuota,
  TaxRateIoResult,
} from "./clients/taxrate-io"

export type CachedStripeQuote = {
  expiresAt: number
  result: StripeTaxCalculationResult
}

export type PersistedTaxRateIoQuota = TaxRateIoQuota & {
  source: "checkout_lookup" | "manual_refresh"
}

const MAX_CACHE_TEXT_LENGTH = 200
const MAX_STRIPE_LINE_ITEMS = 100
const REFERENCE_PATTERN = /^[A-Za-z0-9_-]+$/

const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

const strictNonNegativeSafeInteger = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null

const boundedNullableText = (value: unknown): string | null | undefined => {
  if (value === null) {
    return null
  }
  if (typeof value !== "string") {
    return undefined
  }
  const normalized = value.trim()
  return normalized && normalized.length <= MAX_CACHE_TEXT_LENGTH
    ? normalized
    : undefined
}

const cachedRate = (value: unknown): number | null => {
  const rate = readFiniteNumber(value)
  return rate !== null && rate >= 0 && rate <= 100 ? rate : null
}

const cachedJurisdiction = (
  value: unknown
): TaxRateIoJurisdiction | null | undefined => {
  if (value === null || value === undefined) {
    return null
  }
  const record = asUnknownRecord(value)
  const components = asUnknownRecord(record?.rate_components)
  if (!record || !components) {
    return undefined
  }

  const city = boundedNullableText(record.city)
  const county = boundedNullableText(record.county)
  const name = boundedNullableText(record.name)
  const taxName = boundedNullableText(record.tax_name)
  const countryCode = boundedNullableText(record.country_code)
  const state = boundedNullableText(record.state)
  const level = record.level
  const cityRate = components.city === null ? null : cachedRate(components.city)
  const countyRate =
    components.county === null ? null : cachedRate(components.county)
  const specialRate =
    components.special === null ? null : cachedRate(components.special)
  const stateRate =
    components.state === null ? null : cachedRate(components.state)
  if (
    city === undefined ||
    county === undefined ||
    name === undefined ||
    taxName === undefined ||
    countryCode === undefined ||
    state === undefined ||
    (countryCode !== null && !/^[A-Z]{2}$/.test(countryCode)) ||
    (state !== null && !/^[A-Z0-9 -]{1,20}$/.test(state)) ||
    (level !== null &&
      level !== "city" &&
      level !== "county" &&
      level !== "state") ||
    (components.city !== null && cityRate === null) ||
    (components.county !== null && countyRate === null) ||
    (components.special !== null && specialRate === null) ||
    (components.state !== null && stateRate === null)
  ) {
    return undefined
  }

  return {
    city,
    country_code: countryCode,
    county,
    level,
    name,
    rate_components: {
      city: cityRate,
      county: countyRate,
      special: specialRate,
      state: stateRate,
    },
    state,
    tax_name: taxName,
  }
}

export const parseCachedTaxRateIoResult = (
  value: string
): TaxRateIoResult | null => {
  const parsed = parseJson(value)
  if (typeof parsed === "number") {
    const ratePercent = cachedRate(parsed)
    return ratePercent === null
      ? null
      : { jurisdiction: null, quota: null, ratePercent }
  }

  const record = asUnknownRecord(parsed)
  if (record) {
    const ratePercent = cachedRate(record.ratePercent)
    const jurisdiction = cachedJurisdiction(record.jurisdiction)
    return ratePercent === null || jurisdiction === undefined
      ? null
      : { jurisdiction, quota: null, ratePercent }
  }

  const legacyRate = cachedRate(value)
  return legacyRate === null
    ? null
    : { jurisdiction: null, quota: null, ratePercent: legacyRate }
}

export const parseTaxRateIoQuotaSnapshot = (
  value: unknown
): TaxRateIoQuota | null => {
  const record = asUnknownRecord(value)
  if (!record) {
    return null
  }
  const observedAt = readIsoTimestamp(record.observedAt)
  const quota = strictNonNegativeSafeInteger(record.quota)
  const remaining = strictNonNegativeSafeInteger(record.remaining)
  const usage = strictNonNegativeSafeInteger(record.usage)
  const usagePercent =
    typeof record.usagePercent === "number" &&
    Number.isFinite(record.usagePercent) &&
    record.usagePercent >= 0 &&
    record.usagePercent <= 100
      ? record.usagePercent
      : null
  if (
    !observedAt ||
    quota === null ||
    quota === 0 ||
    remaining === null ||
    usage === null ||
    usage > quota ||
    remaining !== quota - usage ||
    usagePercent === null
  ) {
    return null
  }

  return { observedAt, quota, remaining, usage, usagePercent }
}

export const parsePersistedTaxRateIoQuota = (
  value: unknown
): PersistedTaxRateIoQuota | null => {
  const record = asUnknownRecord(value)
  if (!record || record.provider !== "taxrate_io") {
    return null
  }
  const observedAt = readIsoTimestamp(record.observed_at)
  const quota = readNonNegativeSafeInteger(record.quota)
  const remaining = readNonNegativeSafeInteger(record.remaining)
  const usage = readNonNegativeSafeInteger(record.usage)
  const usagePercent = readFiniteNumber(record.usage_percent)
  const source = record.source
  if (
    !observedAt ||
    quota === null ||
    remaining === null ||
    usage === null ||
    usagePercent === null ||
    (source !== "checkout_lookup" && source !== "manual_refresh")
  ) {
    return null
  }
  const snapshot = parseTaxRateIoQuotaSnapshot({
    observedAt,
    quota,
    remaining,
    usage,
    usagePercent,
  })
  return snapshot ? { ...snapshot, source } : null
}

const cachedStripeResult = (
  value: unknown,
  nowMs: number
): StripeTaxCalculationResult | null => {
  const record = asUnknownRecord(value)
  const itemTaxes = asUnknownRecord(record?.itemTaxByReference)
  if (!record || !itemTaxes) {
    return null
  }
  const calculationId = record.calculationId
  const currency = record.currency
  const amountTotal = strictNonNegativeSafeInteger(record.amountTotal)
  const shippingTax = strictNonNegativeSafeInteger(record.shippingTax)
  const taxAmountExclusive = strictNonNegativeSafeInteger(
    record.taxAmountExclusive
  )
  const expiresAt =
    record.expiresAt === null
      ? null
      : strictNonNegativeSafeInteger(record.expiresAt)
  const entries = Object.entries(itemTaxes)
  if (
    typeof calculationId !== "string" ||
    !/^taxcalc_[A-Za-z0-9]+$/.test(calculationId) ||
    typeof currency !== "string" ||
    !/^[a-z]{3}$/.test(currency) ||
    typeof record.livemode !== "boolean" ||
    amountTotal === null ||
    shippingTax === null ||
    taxAmountExclusive === null ||
    (expiresAt === null && record.expiresAt !== null) ||
    (expiresAt !== null && expiresAt * 1_000 <= nowMs) ||
    entries.length === 0 ||
    entries.length > MAX_STRIPE_LINE_ITEMS
  ) {
    return null
  }

  const parsedEntries = entries.map(([reference, tax]) => {
    const amount = strictNonNegativeSafeInteger(tax)
    return reference.length <= MAX_CACHE_TEXT_LENGTH &&
      REFERENCE_PATTERN.test(reference) &&
      reference !== "__proto__" &&
      amount !== null
      ? ([reference, amount] as const)
      : null
  })
  if (parsedEntries.some((entry) => entry === null)) {
    return null
  }
  const itemTaxByReference = Object.fromEntries(
    parsedEntries.filter((entry) => entry !== null)
  )
  const itemTaxTotal = Object.values(itemTaxByReference).reduce(
    (total, tax) => total + tax,
    0
  )
  if (
    !Number.isSafeInteger(itemTaxTotal) ||
    itemTaxTotal + shippingTax !== taxAmountExclusive ||
    amountTotal < taxAmountExclusive
  ) {
    return null
  }

  return {
    amountTotal,
    calculationId,
    currency,
    expiresAt,
    itemTaxByReference,
    livemode: record.livemode,
    shippingTax,
    taxAmountExclusive,
  }
}

export const parseCachedStripeQuote = (
  value: string,
  nowMs = Date.now()
): CachedStripeQuote | null => {
  const record = asUnknownRecord(parseJson(value))
  const expiresAt = strictNonNegativeSafeInteger(record?.expiresAt)
  const result = cachedStripeResult(record?.result, nowMs)
  if (
    !record ||
    expiresAt === null ||
    expiresAt <= nowMs ||
    !result ||
    (result.expiresAt !== null && expiresAt > result.expiresAt * 1_000)
  ) {
    return null
  }
  return { expiresAt, result }
}
