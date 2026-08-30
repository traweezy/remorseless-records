import type {
  TaxCollectionMode,
  TaxProviderName,
} from "../../modules/tax-control/constants"
import {
  isTaxCollectionMode,
  isTaxProviderName,
} from "../../modules/tax-control/constants"
import {
  readFiniteNumber,
  readNonNegativeSafeInteger,
} from "../provider-boundary/primitives"
import {
  asUnknownRecord,
  readRecordArray,
  type UnknownRecord,
} from "../provider-boundary/records"
import { createTaxContextFingerprint } from "./context"

const invalidFingerprintData = (): Error =>
  new Error("Tax subject fingerprint data is invalid.")

const optionalText = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== "string" || !value.trim()) {
    throw invalidFingerprintData()
  }
  return value.trim()
}

const requiredText = (value: unknown): string => {
  const parsed = optionalText(value)
  if (!parsed) {
    throw invalidFingerprintData()
  }
  return parsed
}

const finiteNonNegativeText = (value: unknown): string => {
  const parsed = readFiniteNumber(value)
  if (parsed === null || parsed < 0) {
    throw invalidFingerprintData()
  }
  return String(parsed)
}

const positiveIntegerText = (value: unknown): string => {
  const parsed = readNonNegativeSafeInteger(value)
  if (parsed === null || parsed <= 0) {
    throw invalidFingerprintData()
  }
  return String(parsed)
}

const fingerprintRecords = (value: unknown): UnknownRecord[] => {
  try {
    return readRecordArray(value, {
      context: "Tax subject fingerprint query",
      optional: true,
    })
  } catch {
    throw invalidFingerprintData()
  }
}

const sorted = (values: unknown[]): unknown[] =>
  [...values].sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right))
  )

const adjustmentsFrom = (value: unknown): unknown[] =>
  fingerprintRecords(value).map((adjustment) => {
    if (
      adjustment.is_tax_inclusive !== null &&
      adjustment.is_tax_inclusive !== undefined &&
      typeof adjustment.is_tax_inclusive !== "boolean"
    ) {
      throw invalidFingerprintData()
    }
    return {
      amount: finiteNonNegativeText(adjustment.amount),
      inclusive: adjustment.is_tax_inclusive === true,
    }
  })

type TaxSubjectFingerprintInput = {
  collectionMode: TaxCollectionMode
  generation: number
  orderOrCart: UnknownRecord
  provider: TaxProviderName | null
}

const legacyText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null

const legacyAdjustmentsFrom = (value: unknown): UnknownRecord[] =>
  (Array.isArray(value) ? value : [])
    .map(asUnknownRecord)
    .filter((record): record is UnknownRecord => record !== null)

const createLegacyTaxSubjectFingerprint = ({
  collectionMode,
  generation,
  orderOrCart,
  provider,
}: TaxSubjectFingerprintInput): string => {
  const address = asUnknownRecord(orderOrCart.shipping_address)
  const items = (Array.isArray(orderOrCart.items) ? orderOrCart.items : [])
    .map(asUnknownRecord)
    .filter((item): item is UnknownRecord => item !== null)
    .map((item) => ({
      id: legacyText(item.id),
      productId: legacyText(item.product_id),
      productTypeId: legacyText(item.product_type_id),
      quantity: String(item.quantity ?? ""),
      unitPrice: String(item.unit_price ?? ""),
      adjustments: sorted(
        legacyAdjustmentsFrom(item.adjustments).map((adjustment) => ({
          amount: String(adjustment.amount ?? ""),
          inclusive: adjustment.is_tax_inclusive === true,
        }))
      ),
    }))
  const shippingMethods = (
    Array.isArray(orderOrCart.shipping_methods)
      ? orderOrCart.shipping_methods
      : []
  )
    .map(asUnknownRecord)
    .filter((method): method is UnknownRecord => method !== null)
    .map((method) => ({
      amount: String(method.amount ?? ""),
      optionId: legacyText(method.shipping_option_id),
      adjustments: sorted(
        legacyAdjustmentsFrom(method.adjustments).map((adjustment) => ({
          amount: String(adjustment.amount ?? ""),
          inclusive: adjustment.is_tax_inclusive === true,
        }))
      ),
    }))

  return createTaxContextFingerprint({
    address: {
      address1: legacyText(address?.address_1),
      address2: legacyText(address?.address_2),
      city: legacyText(address?.city),
      countryCode: legacyText(address?.country_code)?.toLowerCase(),
      postalCode: legacyText(address?.postal_code),
      province: legacyText(address?.province)?.toLowerCase(),
    },
    currencyCode: legacyText(orderOrCart.currency_code)?.toLowerCase(),
    collectionMode,
    generation,
    items: sorted(items),
    provider,
    shippingMethods: sorted(shippingMethods),
    subjectId: legacyText(orderOrCart.id),
  })
}

export const createTaxSubjectFingerprint = ({
  collectionMode,
  generation,
  orderOrCart,
  provider,
}: TaxSubjectFingerprintInput): string => {
  if (
    !isTaxCollectionMode(collectionMode) ||
    readNonNegativeSafeInteger(generation) !== generation ||
    generation <= 0 ||
    (collectionMode === "collect" && !isTaxProviderName(provider)) ||
    (collectionMode === "disabled" && provider !== null)
  ) {
    throw invalidFingerprintData()
  }
  const addressValue = orderOrCart.shipping_address
  const address =
    addressValue === null || addressValue === undefined
      ? null
      : asUnknownRecord(addressValue)
  if (addressValue !== null && addressValue !== undefined && !address) {
    throw invalidFingerprintData()
  }

  const itemIds = new Set<string>()
  const items = fingerprintRecords(orderOrCart.items).map((item) => {
    const id = requiredText(item.id)
    if (itemIds.has(id)) {
      throw invalidFingerprintData()
    }
    itemIds.add(id)
    return {
      id,
      productId: optionalText(item.product_id),
      productTypeId: optionalText(item.product_type_id),
      quantity: positiveIntegerText(item.quantity),
      unitPrice: finiteNonNegativeText(item.unit_price),
      adjustments: sorted(adjustmentsFrom(item.adjustments)),
    }
  })

  const shippingIds = new Set<string>()
  const shippingMethods = fingerprintRecords(orderOrCart.shipping_methods).map(
    (method) => {
      const id = requiredText(method.id)
      if (shippingIds.has(id)) {
        throw invalidFingerprintData()
      }
      shippingIds.add(id)
      return {
        amount: finiteNonNegativeText(method.amount),
        optionId: optionalText(method.shipping_option_id),
        adjustments: sorted(adjustmentsFrom(method.adjustments)),
      }
    }
  )

  const currencyCode = requiredText(orderOrCart.currency_code).toLowerCase()
  if (!/^[a-z]{3}$/.test(currencyCode)) {
    throw invalidFingerprintData()
  }

  return createTaxContextFingerprint({
    address: {
      address1: optionalText(address?.address_1),
      address2: optionalText(address?.address_2),
      city: optionalText(address?.city),
      countryCode: optionalText(address?.country_code)?.toLowerCase(),
      postalCode: optionalText(address?.postal_code),
      province: optionalText(address?.province)?.toLowerCase(),
    },
    currencyCode,
    collectionMode,
    generation,
    items: sorted(items),
    provider,
    shippingMethods: sorted(shippingMethods),
    subjectId: requiredText(orderOrCart.id),
  })
}

export const taxSubjectFingerprintMatches = ({
  fingerprint,
  ...input
}: TaxSubjectFingerprintInput & { fingerprint: string }): boolean => {
  const hardened = createTaxSubjectFingerprint(input)
  return (
    fingerprint === hardened ||
    fingerprint === createLegacyTaxSubjectFingerprint(input)
  )
}
