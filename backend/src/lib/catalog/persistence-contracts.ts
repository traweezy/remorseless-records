import { MedusaError } from "@medusajs/framework/utils"

import { readNonNegativeSafeInteger } from "../provider-boundary/primitives"
import {
  asUnknownRecord,
  readProviderDataRecords,
  readRecordArray,
  type UnknownRecord,
} from "../provider-boundary/records"

const MAX_CATALOG_IDENTIFIER_LENGTH = 255
const CATALOG_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

const invalidCatalogData = (): never => {
  throw new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    "The catalog persistence boundary returned invalid structured data."
  )
}

const catalogIdentifier = (value: unknown): string | null =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= MAX_CATALOG_IDENTIFIER_LENGTH &&
  value === value.trim() &&
  CATALOG_IDENTIFIER.test(value)
    ? value
    : null

const requiredCatalogIdentifier = (value: unknown): string =>
  catalogIdentifier(value) ?? invalidCatalogData()

const nullableCatalogIdentifier = (value: unknown): string | null =>
  value === null ? null : requiredCatalogIdentifier(value)

const nullableCatalogText = (value: unknown): string | null => {
  if (value === null) {
    return null
  }
  if (typeof value !== "string") {
    return invalidCatalogData()
  }
  return value
}

const positiveSafeInteger = (value: unknown): number => {
  const parsed = readNonNegativeSafeInteger(value)
  return parsed !== null && parsed > 0 ? parsed : invalidCatalogData()
}

const nonNegativeSafeInteger = (value: unknown): number =>
  readNonNegativeSafeInteger(value) ?? invalidCatalogData()

const requiredRecord = (value: unknown): UnknownRecord =>
  asUnknownRecord(value) ?? invalidCatalogData()

const graphRows = (value: unknown): UnknownRecord[] => {
  try {
    return readProviderDataRecords(value, "Catalog graph query")
  } catch {
    return invalidCatalogData()
  }
}

const serviceRows = (value: unknown): UnknownRecord[] => {
  try {
    return readRecordArray(value, { context: "Catalog service query" })
  } catch {
    return invalidCatalogData()
  }
}

const assertExpectedIdentifier = (
  identifier: string,
  expected: ReadonlySet<string> | null
): void => {
  if (expected && !expected.has(identifier)) {
    invalidCatalogData()
  }
}

const assertUniqueIdentifier = (
  identifier: string,
  seen: Set<string>
): void => {
  if (seen.has(identifier)) {
    invalidCatalogData()
  }
  seen.add(identifier)
}

export const readCatalogEntityIds = (
  value: unknown,
  expectedIds?: readonly string[]
): string[] => {
  const expected = expectedIds ? new Set(expectedIds) : null
  const seen = new Set<string>()
  return graphRows(value).map((row) => {
    const id = requiredCatalogIdentifier(row.id)
    assertExpectedIdentifier(id, expected)
    assertUniqueIdentifier(id, seen)
    return id
  })
}

export type CatalogVariantOwnership = {
  id: string
  productId: string
}

export const readCatalogVariantOwnerships = (
  value: unknown,
  expectedVariantIds: readonly string[]
): CatalogVariantOwnership[] => {
  const expected = new Set(expectedVariantIds)
  const seen = new Set<string>()

  return graphRows(value).map((row) => {
    const id = requiredCatalogIdentifier(row.id)
    assertExpectedIdentifier(id, expected)
    assertUniqueIdentifier(id, seen)

    const hasDirectProductId = Object.hasOwn(row, "product_id")
    const directProductId = hasDirectProductId
      ? catalogIdentifier(row.product_id)
      : null
    const hasNestedProduct = Object.hasOwn(row, "product")
    const nestedProduct = hasNestedProduct ? asUnknownRecord(row.product) : null
    const nestedProductId = nestedProduct
      ? catalogIdentifier(nestedProduct.id)
      : null

    if (
      (hasDirectProductId && !directProductId) ||
      (hasNestedProduct && !nestedProductId) ||
      (!directProductId && !nestedProductId) ||
      (directProductId &&
        nestedProductId &&
        directProductId !== nestedProductId)
    ) {
      invalidCatalogData()
    }

    return { id, productId: directProductId ?? nestedProductId! }
  })
}

export type CatalogVariantInventoryLink = {
  inventoryItemId: string
  requiredQuantity: number | null
  variantId: string
}

export const readCatalogVariantInventoryLinks = (
  value: unknown,
  expectedVariantIds: readonly string[],
  options: { requireQuantity?: boolean } = {}
): CatalogVariantInventoryLink[] => {
  const expected = new Set(expectedVariantIds)
  const seen = new Set<string>()

  return graphRows(value).map((row) => {
    const variantId = requiredCatalogIdentifier(row.variant_id)
    const inventoryItemId = requiredCatalogIdentifier(row.inventory_item_id)
    assertExpectedIdentifier(variantId, expected)
    const key = `${variantId}:${inventoryItemId}`
    assertUniqueIdentifier(key, seen)

    const parsedQuantity = Object.hasOwn(row, "required_quantity")
      ? readNonNegativeSafeInteger(row.required_quantity)
      : null
    const requiredQuantity =
      parsedQuantity !== null && parsedQuantity > 0 ? parsedQuantity : null
    if (options.requireQuantity && requiredQuantity === null) {
      invalidCatalogData()
    }

    return { inventoryItemId, requiredQuantity, variantId }
  })
}

export const readCatalogProductVariantIds = (
  value: unknown,
  expectedProductId: string
): string[] => {
  const products = graphRows(value)
  if (!products.length) {
    return []
  }
  if (products.length !== 1) {
    return invalidCatalogData()
  }

  const product = products[0]!
  if (requiredCatalogIdentifier(product.id) !== expectedProductId) {
    return invalidCatalogData()
  }

  let variants: UnknownRecord[]
  try {
    variants = readRecordArray(product.variants, {
      context: "Catalog product variants",
    })
  } catch {
    return invalidCatalogData()
  }
  const seen = new Set<string>()
  return variants.map((variant) => {
    const id = requiredCatalogIdentifier(variant.id)
    assertUniqueIdentifier(id, seen)
    return id
  })
}

export type CatalogCreatedVariant = {
  creationKey: string
  id: string
}

export const readCatalogCreatedProductId = (value: unknown): string => {
  const products = serviceRows(value)
  if (products.length !== 1) {
    return invalidCatalogData()
  }
  return requiredCatalogIdentifier(products[0]!.id)
}

export const readCatalogCreatedProductVariants = (
  value: unknown,
  expectedProductId: string,
  expectedCreationKeys: readonly string[],
  creationKeyField: string
): CatalogCreatedVariant[] => {
  const products = graphRows(value)
  if (products.length !== 1) {
    return invalidCatalogData()
  }
  const product = products[0]!
  if (requiredCatalogIdentifier(product.id) !== expectedProductId) {
    return invalidCatalogData()
  }

  let variants: UnknownRecord[]
  try {
    variants = readRecordArray(product.variants, {
      context: "Created catalog product variants",
    })
  } catch {
    return invalidCatalogData()
  }
  if (variants.length !== expectedCreationKeys.length) {
    return invalidCatalogData()
  }

  const expected = new Set(expectedCreationKeys)
  const seenIds = new Set<string>()
  const seenKeys = new Set<string>()
  const parsed = variants.map((variant) => {
    const id = requiredCatalogIdentifier(variant.id)
    const metadata = asUnknownRecord(variant.metadata)
    const creationKey = catalogIdentifier(metadata?.[creationKeyField])
    if (!creationKey || !expected.has(creationKey)) {
      return invalidCatalogData()
    }
    assertUniqueIdentifier(id, seenIds)
    assertUniqueIdentifier(creationKey, seenKeys)
    return { creationKey, id }
  })
  if (seenKeys.size !== expected.size) {
    return invalidCatalogData()
  }
  return parsed
}

export const readCatalogServiceIds = (
  value: unknown,
  maximumRows = Number.MAX_SAFE_INTEGER
): string[] => {
  const parsedRows = serviceRows(value)
  if (parsedRows.length > maximumRows) {
    return invalidCatalogData()
  }
  const seen = new Set<string>()
  return parsedRows.map((row) => {
    const id = requiredCatalogIdentifier(row.id)
    assertUniqueIdentifier(id, seen)
    return id
  })
}

export type CatalogStoreDefaults = {
  defaultSalesChannelId: string | null
  id: string
}

export const readCatalogStoreDefaults = (
  value: unknown
): CatalogStoreDefaults[] => {
  const seen = new Set<string>()
  return serviceRows(value).map((row) => {
    const id = requiredCatalogIdentifier(row.id)
    assertUniqueIdentifier(id, seen)
    const rawSalesChannelId = row.default_sales_channel_id
    const defaultSalesChannelId =
      rawSalesChannelId === null || rawSalesChannelId === undefined
        ? null
        : catalogIdentifier(rawSalesChannelId)
    if (
      rawSalesChannelId !== null &&
      rawSalesChannelId !== undefined &&
      !defaultSalesChannelId
    ) {
      return invalidCatalogData()
    }
    return { defaultSalesChannelId, id }
  })
}

export type CatalogBundleProfileBoundary = {
  id: string
  inventory_mode: "component_derived" | "manual"
  is_active: boolean
  product_id: string
}

export const readCatalogBundleProfiles = (
  value: unknown,
  expectedProductId: string
): CatalogBundleProfileBoundary[] => {
  const rows = serviceRows(value)
  if (rows.length > 1) {
    return invalidCatalogData()
  }
  return rows.map((row) => {
    const productId = requiredCatalogIdentifier(row.product_id)
    const inventoryMode = row.inventory_mode
    if (
      productId !== expectedProductId ||
      (inventoryMode !== "component_derived" && inventoryMode !== "manual") ||
      typeof row.is_active !== "boolean"
    ) {
      return invalidCatalogData()
    }
    return {
      id: requiredCatalogIdentifier(row.id),
      inventory_mode: inventoryMode,
      is_active: row.is_active,
      product_id: productId,
    }
  })
}

export type CatalogStoreBundleProfileBoundary = {
  bundle_type: "deal" | "fixed" | "mystery" | "selectable"
  display_title: string | null
  id: string
  is_active: boolean
  product_id: string
}

export const readCatalogStoreBundleProfiles = (
  value: unknown,
  expectedProductId: string
): CatalogStoreBundleProfileBoundary[] => {
  const rows = serviceRows(value)
  if (rows.length > 1) {
    return invalidCatalogData()
  }
  return rows.map((row) => {
    const bundleType = row.bundle_type
    const productId = requiredCatalogIdentifier(row.product_id)
    if (
      productId !== expectedProductId ||
      (bundleType !== "deal" &&
        bundleType !== "fixed" &&
        bundleType !== "mystery" &&
        bundleType !== "selectable") ||
      typeof row.is_active !== "boolean"
    ) {
      return invalidCatalogData()
    }
    return {
      bundle_type: bundleType,
      display_title: nullableCatalogText(row.display_title),
      id: requiredCatalogIdentifier(row.id),
      is_active: row.is_active,
      product_id: productId,
    }
  })
}

export type CatalogBundleComponentBoundary = {
  bundle_profile_id: string
  component_inventory_item_id: string | null
  component_product_id: string
  component_variant_id: string | null
  id: string
  is_required: boolean
  metadata: UnknownRecord
  quantity: number
  sku: string | null
  sort_order: number
  title: string | null
  variant_title: string | null
}

export const readCatalogBundleComponents = (
  value: unknown,
  expectedProfileId: string
): CatalogBundleComponentBoundary[] => {
  const seen = new Set<string>()
  return serviceRows(value).map((row) => {
    const id = requiredCatalogIdentifier(row.id)
    const profileId = requiredCatalogIdentifier(row.bundle_profile_id)
    if (
      profileId !== expectedProfileId ||
      typeof row.is_required !== "boolean"
    ) {
      return invalidCatalogData()
    }
    assertUniqueIdentifier(id, seen)
    return {
      bundle_profile_id: profileId,
      component_inventory_item_id: nullableCatalogIdentifier(
        row.component_inventory_item_id
      ),
      component_product_id: requiredCatalogIdentifier(row.component_product_id),
      component_variant_id: nullableCatalogIdentifier(row.component_variant_id),
      id,
      is_required: row.is_required,
      metadata: requiredRecord(row.metadata),
      quantity: positiveSafeInteger(row.quantity),
      sku: nullableCatalogText(row.sku),
      sort_order: nonNegativeSafeInteger(row.sort_order),
      title: nullableCatalogText(row.title),
      variant_title: nullableCatalogText(row.variant_title),
    }
  })
}

export type CatalogBundleInventoryProvenanceBoundary = {
  bundle_profile_id: string
  bundle_variant_id: string
  id: string
  inventory_item_id: string
  metadata: UnknownRecord
  required_quantity: number
}

export const readCatalogBundleInventoryProvenance = (
  value: unknown,
  expectedProfileId: string
): CatalogBundleInventoryProvenanceBoundary[] => {
  const seenIds = new Set<string>()
  const seenLinks = new Set<string>()
  return serviceRows(value).map((row) => {
    const id = requiredCatalogIdentifier(row.id)
    const profileId = requiredCatalogIdentifier(row.bundle_profile_id)
    const variantId = requiredCatalogIdentifier(row.bundle_variant_id)
    const inventoryItemId = requiredCatalogIdentifier(row.inventory_item_id)
    if (profileId !== expectedProfileId) {
      return invalidCatalogData()
    }
    assertUniqueIdentifier(id, seenIds)
    assertUniqueIdentifier(`${variantId}:${inventoryItemId}`, seenLinks)
    return {
      bundle_profile_id: profileId,
      bundle_variant_id: variantId,
      id,
      inventory_item_id: inventoryItemId,
      metadata: requiredRecord(row.metadata),
      required_quantity: positiveSafeInteger(row.required_quantity),
    }
  })
}

export type CatalogOrphanMediaPage = {
  count: number
  rows: UnknownRecord[]
}

export const readCatalogOrphanMediaPage = (
  countRowsValue: unknown,
  rowsValue: unknown
): CatalogOrphanMediaPage => {
  const countRows = serviceRows(countRowsValue)
  const rows = serviceRows(rowsValue)
  if (countRows.length !== 1) {
    return invalidCatalogData()
  }
  const count = readNonNegativeSafeInteger(countRows[0]!.count)
  if (count === null || count < rows.length) {
    return invalidCatalogData()
  }

  const seen = new Set<string>()
  rows.forEach((row) => {
    const id = requiredCatalogIdentifier(row.id)
    assertUniqueIdentifier(id, seen)
  })
  return { count, rows }
}
