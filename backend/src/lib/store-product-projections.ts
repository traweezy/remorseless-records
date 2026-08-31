import { MedusaError, ProductStatus } from "@medusajs/framework/utils"

import { readIsoTimestamp } from "./provider-boundary/primitives"
import {
  asUnknownRecord,
  readRecordArray,
  type UnknownRecord,
} from "./provider-boundary/records"

const STORE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,254}$/u

const invalidStoreProductProjection = (): never => {
  throw new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    "The Store product projection returned invalid structured data."
  )
}

const requiredIdentifier = (value: unknown): string =>
  typeof value === "string" &&
  value.length > 0 &&
  value === value.trim() &&
  STORE_IDENTIFIER.test(value)
    ? value
    : invalidStoreProductProjection()

const requiredText = (value: unknown, maximumLength: number): string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= maximumLength &&
  value === value.trim() &&
  !/[\u0000-\u001f\u007f]/u.test(value)
    ? value
    : invalidStoreProductProjection()

const nullableIdentifier = (value: unknown): string | null =>
  value === null || value === undefined ? null : requiredIdentifier(value)

const nullableTimestamp = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null
  }
  return readIsoTimestamp(value) ?? invalidStoreProductProjection()
}

export type StoreProductHandleProjection = {
  created_at: string | null
  handle: string
  id: string
  updated_at: string | null
}

export const readStoreProductHandleProjection = (
  product: UnknownRecord
): StoreProductHandleProjection => ({
  created_at: nullableTimestamp(product.created_at),
  handle: requiredText(product.handle, 200),
  id: requiredIdentifier(product.id),
  updated_at: nullableTimestamp(product.updated_at),
})

export const readStoreProductHandleProjections = (
  value: unknown
): StoreProductHandleProjection[] => {
  let records: ReturnType<typeof readRecordArray>
  try {
    records = readRecordArray(value, { context: "Store product handles" })
  } catch {
    return invalidStoreProductProjection()
  }
  const seen = new Set<string>()
  return records.map((record) => {
    const projection = readStoreProductHandleProjection(record)
    const { id } = projection
    if (seen.has(id)) {
      return invalidStoreProductProjection()
    }
    seen.add(id)
    return projection
  })
}

const records = (value: unknown, context: string): UnknownRecord[] => {
  try {
    return readRecordArray(value, { context })
  } catch {
    return invalidStoreProductProjection()
  }
}

const assertUniqueProductId = (id: string, seen: Set<string>): void => {
  if (seen.has(id)) {
    invalidStoreProductProjection()
  }
  seen.add(id)
}

export type StoreDiscographyProductProjection = {
  handle: string
  id: string
  status: typeof ProductStatus.PUBLISHED
}

export const readStoreDiscographyProductProjection = (
  product: UnknownRecord
): StoreDiscographyProductProjection => {
  if (product.status !== ProductStatus.PUBLISHED) {
    return invalidStoreProductProjection()
  }
  return {
    handle: requiredText(product.handle, 200),
    id: requiredIdentifier(product.id),
    status: ProductStatus.PUBLISHED,
  }
}

export const readStoreDiscographyProductProjections = (
  value: unknown
): StoreDiscographyProductProjection[] => {
  const seen = new Set<string>()
  return records(value, "Store discography Products").map((product) => {
    const projection = readStoreDiscographyProductProjection(product)
    const { id } = projection
    assertUniqueProductId(id, seen)
    return projection
  })
}

export type StoreShelfProductProjection = {
  created_at: string
  id: string
}

export const readStoreShelfProductProjection = (
  product: UnknownRecord
): StoreShelfProductProjection => {
  const createdAt = readIsoTimestamp(product.created_at)
  if (!createdAt) {
    return invalidStoreProductProjection()
  }
  return { created_at: createdAt, id: requiredIdentifier(product.id) }
}

export const readStoreShelfProductProjections = (
  value: unknown
): StoreShelfProductProjection[] => {
  const seen = new Set<string>()
  return records(value, "Store shelf Products").map((product) => {
    const projection = readStoreShelfProductProjection(product)
    const { id } = projection
    assertUniqueProductId(id, seen)
    return projection
  })
}

export type StoreRelatedCategoryProjection = {
  handle: string
  id: string
  name: string
  parent_category: {
    handle: string
    id: string
    name: string
  } | null
  parent_category_id: string | null
}

export type StoreRelatedProductProjection = {
  categories: StoreRelatedCategoryProjection[]
  collection: { id: string; title: string } | null
  collection_id: string | null
  handle: string
  id: string
  metadata: Record<string, string>
  status: typeof ProductStatus.PUBLISHED
  title: string
}

const RELATED_METADATA_KEYS = [
  "Album",
  "Artist",
  "album",
  "albumSlug",
  "album_slug",
  "artist",
  "artistSlug",
  "artist_name",
  "artist_slug",
  "release",
] as const

const relatedMetadata = (value: unknown): Record<string, string> => {
  if (value === null || value === undefined) {
    return {}
  }
  const raw = asUnknownRecord(value)
  if (!raw) {
    return invalidStoreProductProjection()
  }
  return Object.fromEntries(
    RELATED_METADATA_KEYS.flatMap((key) => {
      if (!Object.hasOwn(raw, key)) {
        return []
      }
      return [[key, requiredText(raw[key], 500)]]
    })
  )
}

const relatedCategory = (
  value: UnknownRecord
): StoreRelatedCategoryProjection => {
  const id = requiredIdentifier(value.id)
  const parentCategoryId = nullableIdentifier(value.parent_category_id)
  const rawParent = value.parent_category
  const parent =
    rawParent === null || rawParent === undefined
      ? null
      : (asUnknownRecord(rawParent) ?? invalidStoreProductProjection())
  const parentCategory = parent
    ? {
        handle: requiredText(parent.handle, 200),
        id: requiredIdentifier(parent.id),
        name: requiredText(parent.name, 500),
      }
    : null
  if (
    parentCategoryId &&
    parentCategory &&
    parentCategory.id !== parentCategoryId
  ) {
    return invalidStoreProductProjection()
  }
  return {
    handle: requiredText(value.handle, 200),
    id,
    name: requiredText(value.name, 500),
    parent_category: parentCategory,
    parent_category_id: parentCategoryId,
  }
}

export const readStoreRelatedProductProjection = (
  product: UnknownRecord
): StoreRelatedProductProjection => {
  const id = requiredIdentifier(product.id)
  if (product.status !== ProductStatus.PUBLISHED) {
    return invalidStoreProductProjection()
  }
  const collectionId = nullableIdentifier(product.collection_id)
  const rawCollection = product.collection
  const collectionRecord =
    rawCollection === null || rawCollection === undefined
      ? null
      : (asUnknownRecord(rawCollection) ?? invalidStoreProductProjection())
  const collection = collectionRecord
    ? {
        id: requiredIdentifier(collectionRecord.id),
        title: requiredText(collectionRecord.title, 500),
      }
    : null
  if (collectionId && collection && collection.id !== collectionId) {
    return invalidStoreProductProjection()
  }
  const categories = records(
    product.categories,
    "Store related Product categories"
  ).map(relatedCategory)
  const categoryIds = new Set(categories.map((category) => category.id))
  if (categoryIds.size !== categories.length) {
    return invalidStoreProductProjection()
  }
  return {
    categories,
    collection,
    collection_id: collectionId,
    handle: requiredText(product.handle, 200),
    id,
    metadata: relatedMetadata(product.metadata),
    status: ProductStatus.PUBLISHED,
    title: requiredText(product.title, 500),
  }
}

export const readStoreRelatedProductProjections = (
  value: unknown
): StoreRelatedProductProjection[] => {
  const seen = new Set<string>()
  return records(value, "Store related Products").map((product) => {
    const projection = readStoreRelatedProductProjection(product)
    assertUniqueProductId(projection.id, seen)
    return projection
  })
}
