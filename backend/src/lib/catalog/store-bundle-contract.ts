import { MedusaError } from "@medusajs/framework/utils"

import { readFiniteNumber } from "../provider-boundary/primitives"
import {
  asUnknownRecord,
  readRecordArray,
  type UnknownRecord,
} from "../provider-boundary/records"

const STORE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,254}$/u

const invalidStoreBundleData = (): never => {
  throw new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    "The Store bundle projection returned invalid structured data."
  )
}

const identifier = (value: unknown): string | null =>
  typeof value === "string" &&
  value.length > 0 &&
  value === value.trim() &&
  STORE_IDENTIFIER.test(value)
    ? value
    : null

const requiredIdentifier = (value: unknown): string =>
  identifier(value) ?? invalidStoreBundleData()

const expectedIdentifiers = (values: readonly string[]): Set<string> => {
  const normalized = values.map(requiredIdentifier)
  const result = new Set(normalized)
  if (result.size !== normalized.length) {
    return invalidStoreBundleData()
  }
  return result
}

const text = (value: unknown, maximumLength: number): string | null =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= maximumLength &&
  value === value.trim() &&
  !/[\u0000-\u001f\u007f]/u.test(value)
    ? value
    : null

const requiredText = (value: unknown, maximumLength: number): string =>
  text(value, maximumLength) ?? invalidStoreBundleData()

const records = (value: unknown, context: string): UnknownRecord[] => {
  try {
    return readRecordArray(value, { context })
  } catch {
    return invalidStoreBundleData()
  }
}

export type StoreBundleVariant = {
  id: string
  sku: string | null
  title: string
}

export type StoreBundleProduct = {
  handle: string
  id: string
  title: string
  variants: StoreBundleVariant[]
}

export const readStoreBundleProducts = (
  value: unknown,
  expectedProductIds: readonly string[]
): StoreBundleProduct[] => {
  const expected = expectedIdentifiers(expectedProductIds)
  const seenProducts = new Set<string>()
  return records(value, "Store bundle products").map((product) => {
    const id = requiredIdentifier(product.id)
    if (!expected.has(id) || seenProducts.has(id)) {
      return invalidStoreBundleData()
    }
    seenProducts.add(id)

    const seenVariants = new Set<string>()
    const variants = records(
      product.variants,
      "Store bundle Product variants"
    ).map((variant) => {
      const variantId = requiredIdentifier(variant.id)
      if (seenVariants.has(variantId)) {
        return invalidStoreBundleData()
      }
      seenVariants.add(variantId)
      const rawSku = variant.sku
      const sku =
        rawSku === null || rawSku === undefined ? null : text(rawSku, 500)
      if (rawSku !== null && rawSku !== undefined && !sku) {
        return invalidStoreBundleData()
      }
      return {
        id: variantId,
        sku,
        title: requiredText(variant.title, 500),
      }
    })

    return {
      handle: requiredText(product.handle, 200),
      id,
      title: requiredText(product.title, 500),
      variants,
    }
  })
}

export const readStoreBundleAvailability = (
  value: unknown,
  expectedVariantIds: readonly string[]
): Record<string, number | null> => {
  const availability = asUnknownRecord(value)
  if (!availability) {
    return invalidStoreBundleData()
  }
  const expected = expectedIdentifiers(expectedVariantIds)
  const result: Record<string, number | null> = Object.fromEntries(
    expectedVariantIds.map((variantId) => [variantId, null])
  )

  for (const [variantId, rawEntry] of Object.entries(availability)) {
    if (!expected.has(variantId)) {
      invalidStoreBundleData()
    }
    const entry = asUnknownRecord(rawEntry) ?? invalidStoreBundleData()
    if (!Object.hasOwn(entry, "availability")) {
      invalidStoreBundleData()
    }
    if (entry.availability === null) {
      result[variantId] = null
      continue
    }
    const parsed = readFiniteNumber(entry.availability)
    if (parsed === null || !Number.isSafeInteger(parsed) || parsed < 0) {
      invalidStoreBundleData()
    }
    result[variantId] = parsed
  }

  return result
}
