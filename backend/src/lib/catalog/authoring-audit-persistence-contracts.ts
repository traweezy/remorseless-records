import { MedusaError } from "@medusajs/framework/utils"

import type {
  CatalogProductProfileRecord,
  CatalogReferenceValueRecord,
  JsonRecord,
} from "@/modules/catalog/serializers"
import type { CatalogBundleProfileState } from "@/modules/catalog/bundle-authoring"

import { readCatalogProductProfileList } from "./profile-persistence-contracts"
import { readCatalogBundleStatePage } from "./transaction-persistence-contracts"
import { readCatalogReferenceValuePage } from "./profile-persistence-contracts"
import {
  asUnknownRecord,
  readCountedRecordPage,
  type UnknownRecord,
} from "../provider-boundary/records"

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,254}$/u
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u
const FORBIDDEN_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"])

export const CATALOG_AUTHORING_AUDIT_PAGE_SIZE = 250
export const CATALOG_AUTHORING_AUDIT_MAXIMUM_RECORDS = 25_000

const invalidAuditPersistence = (): never => {
  throw new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    "The catalog authoring audit persistence boundary returned invalid structured data."
  )
}

export const readCatalogAuthoringAuditService = <T>(
  value: unknown,
  requiredMethods: readonly string[]
): T => {
  const service = asUnknownRecord(value)
  if (
    !service ||
    requiredMethods.some((method) => typeof service[method] !== "function")
  ) {
    return invalidAuditPersistence()
  }
  return value as T
}

const identifier = (value: unknown, prefix: string): string =>
  typeof value === "string" &&
  value === value.trim() &&
  value.startsWith(prefix) &&
  IDENTIFIER.test(value)
    ? value
    : invalidAuditPersistence()

const text = (value: unknown, maximum: number): string =>
  typeof value === "string" &&
  value === value.trim() &&
  value.length > 0 &&
  value.length <= maximum &&
  !CONTROL_CHARACTER.test(value)
    ? value
    : invalidAuditPersistence()

const nullableText = (value: unknown, maximum: number): string | null =>
  value === null ? null : text(value, maximum)

const parseJson = (value: unknown, depth: number): unknown => {
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value
  }
  if (typeof value === "string") {
    return value.length <= 50_000 && !value.includes("\u0000")
      ? value
      : invalidAuditPersistence()
  }
  if (depth >= 8) {
    return invalidAuditPersistence()
  }
  if (Array.isArray(value)) {
    return value.length <= 500
      ? value.map((entry) => parseJson(entry, depth + 1))
      : invalidAuditPersistence()
  }
  const source = asUnknownRecord(value)
  if (!source || Object.keys(source).length > 200) {
    return invalidAuditPersistence()
  }
  return Object.fromEntries(
    Object.entries(source).map(([key, entry]) => {
      if (
        !key ||
        key.length > 255 ||
        key.includes("\u0000") ||
        FORBIDDEN_JSON_KEYS.has(key)
      ) {
        invalidAuditPersistence()
      }
      return [key, parseJson(entry, depth + 1)]
    })
  )
}

const jsonRecord = (value: unknown): JsonRecord => {
  const parsed = asUnknownRecord(parseJson(value, 0))
  return parsed && JSON.stringify(parsed).length <= 100_000
    ? parsed
    : invalidAuditPersistence()
}

export type CatalogAuthoringAuditProductPersistenceRecord = {
  handle: string | null
  id: string
  metadata: JsonRecord | null
  status: "draft" | "proposed" | "published" | "rejected"
  title: string
  type: { value: string } | null
}

export type CatalogAuthoringAuditPersistencePage<T> = {
  count: number
  records: T[]
}

const productRecord = (
  value: UnknownRecord
): CatalogAuthoringAuditProductPersistenceRecord => {
  const productType =
    value.type === null
      ? null
      : (() => {
          const source = asUnknownRecord(value.type)
          return source
            ? { value: text(source.value, 500) }
            : invalidAuditPersistence()
        })()
  const status = text(value.status, 32)
  if (
    status !== "draft" &&
    status !== "proposed" &&
    status !== "published" &&
    status !== "rejected"
  ) {
    return invalidAuditPersistence()
  }
  return {
    handle: nullableText(value.handle, 255),
    id: identifier(value.id, "prod_"),
    metadata: value.metadata === null ? null : jsonRecord(value.metadata),
    status,
    title: text(value.title, 500),
    type: productType,
  }
}

const countedPage = (
  value: unknown
): ReturnType<typeof readCountedRecordPage> => {
  try {
    return readCountedRecordPage(value, "Catalog authoring audit")
  } catch {
    return invalidAuditPersistence()
  }
}

const assertPageBounds = (
  count: number,
  recordCount: number,
  maximumRows: number
): void => {
  if (
    count > CATALOG_AUTHORING_AUDIT_MAXIMUM_RECORDS ||
    recordCount > maximumRows
  ) {
    invalidAuditPersistence()
  }
}

export const readCatalogAuthoringAuditProductPage = (
  value: unknown,
  maximumRows: number
): CatalogAuthoringAuditPersistencePage<CatalogAuthoringAuditProductPersistenceRecord> => {
  const page = countedPage(value)
  assertPageBounds(page.count, page.records.length, maximumRows)
  const ids = new Set<string>()
  const handles = new Set<string>()
  return {
    count: page.count,
    records: page.records.map((entry) => {
      const product = productRecord(entry)
      if (
        ids.has(product.id) ||
        (product.handle !== null && handles.has(product.handle))
      ) {
        return invalidAuditPersistence()
      }
      ids.add(product.id)
      if (product.handle !== null) {
        handles.add(product.handle)
      }
      return product
    }),
  }
}

export const readCatalogAuthoringAuditProfilePage = (
  value: unknown,
  maximumRows: number
): CatalogAuthoringAuditPersistencePage<CatalogProductProfileRecord> => {
  const page = countedPage(value)
  assertPageBounds(page.count, page.records.length, maximumRows)
  return {
    count: page.count,
    records: readCatalogProductProfileList(page.records, maximumRows),
  }
}

export const readCatalogAuthoringAuditReferencePage = (
  value: unknown,
  maximumRows: number
): CatalogAuthoringAuditPersistencePage<CatalogReferenceValueRecord> => {
  const page = readCatalogReferenceValuePage(value, maximumRows)
  assertPageBounds(page.count, page.records.length, maximumRows)
  if (page.records.some(({ kind }) => kind !== "product_type")) {
    return invalidAuditPersistence()
  }
  return page
}

export const readCatalogAuthoringAuditBundlePage = (
  value: unknown,
  maximumRows: number
): CatalogAuthoringAuditPersistencePage<CatalogBundleProfileState> => {
  const page = readCatalogBundleStatePage(value, { maximumRows })
  assertPageBounds(page.count, page.rows.length, maximumRows)
  return { count: page.count, records: page.rows }
}

export const loadAllCatalogAuthoringAuditRecords = async <T>({
  identity,
  listPage,
  readPage,
}: {
  identity: (record: T) => string
  listPage: (skip: number, take: number) => Promise<unknown>
  readPage: (
    value: unknown,
    maximumRows: number
  ) => CatalogAuthoringAuditPersistencePage<T>
}): Promise<T[]> => {
  const records: T[] = []
  const identities = new Set<string>()
  let expectedCount: number | null = null

  while (expectedCount === null || records.length < expectedCount) {
    const page = readPage(
      await listPage(records.length, CATALOG_AUTHORING_AUDIT_PAGE_SIZE),
      CATALOG_AUTHORING_AUDIT_PAGE_SIZE
    )
    expectedCount ??= page.count
    const expectedPageLength = Math.min(
      CATALOG_AUTHORING_AUDIT_PAGE_SIZE,
      expectedCount - records.length
    )
    if (
      page.count !== expectedCount ||
      expectedPageLength < 0 ||
      page.records.length !== expectedPageLength
    ) {
      return invalidAuditPersistence()
    }
    for (const record of page.records) {
      const key = identity(record)
      if (!key || identities.has(key)) {
        return invalidAuditPersistence()
      }
      identities.add(key)
      records.push(record)
    }
  }

  return records.length === expectedCount ? records : invalidAuditPersistence()
}

export const assertCatalogAuthoringAuditRelationships = ({
  bundles,
  products,
  profiles,
  references,
}: {
  bundles: readonly CatalogBundleProfileState[]
  products: readonly CatalogAuthoringAuditProductPersistenceRecord[]
  profiles: readonly CatalogProductProfileRecord[]
  references: readonly CatalogReferenceValueRecord[]
}): void => {
  const productIds = new Set(products.map(({ id }) => id))
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]))
  const referenceIds = new Set<string>()
  const referenceKeys = new Set<string>()
  for (const reference of references) {
    const key = `${reference.kind}:${reference.value}`
    if (referenceIds.has(reference.id) || referenceKeys.has(key)) {
      invalidAuditPersistence()
    }
    referenceIds.add(reference.id)
    referenceKeys.add(key)
  }
  for (const profile of profiles) {
    if (!productIds.has(profile.product_id)) {
      invalidAuditPersistence()
    }
  }
  for (const bundle of bundles) {
    const profile =
      bundle.product_profile_id === null
        ? null
        : profileById.get(bundle.product_profile_id)
    if (
      !productIds.has(bundle.product_id) ||
      (bundle.product_profile_id !== null &&
        (!profile || profile.product_id !== bundle.product_id))
    ) {
      invalidAuditPersistence()
    }
  }
}
