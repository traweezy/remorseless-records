import { MedusaError } from "@medusajs/framework/utils"

import {
  catalogShelfAutomationTypeValues,
  catalogShelfModeValues,
  type CatalogProductProfileRecord,
  type CatalogShelfProductRecord,
  type CatalogShelfRecord,
  type JsonRecord,
} from "@/modules/catalog/serializers"

import {
  readIsoTimestamp,
  readNonNegativeSafeInteger,
} from "../provider-boundary/primitives"
import {
  asUnknownRecord,
  readCountedRecordPage,
  readRecordArray,
  type UnknownRecord,
} from "../provider-boundary/records"

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,254}$/u
const HANDLE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const SHA256 = /^[a-f0-9]{64}$/u
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const FORBIDDEN_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"])

const invalidShelfPersistence = (): never => {
  throw new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    "The catalog shelf persistence boundary returned invalid structured data."
  )
}

const requiredRecord = (value: unknown): UnknownRecord =>
  asUnknownRecord(value) ?? invalidShelfPersistence()

const records = (value: unknown): UnknownRecord[] => {
  try {
    return readRecordArray(value, { context: "Catalog shelf service" })
  } catch {
    return invalidShelfPersistence()
  }
}

const requiredIdentifier = (value: unknown, prefix: string): string =>
  typeof value === "string" &&
  value.startsWith(prefix) &&
  value === value.trim() &&
  IDENTIFIER.test(value)
    ? value
    : invalidShelfPersistence()

const nullableIdentifier = (value: unknown, prefix: string): string | null =>
  value === null ? null : requiredIdentifier(value, prefix)

const requiredText = (value: unknown, maximumLength: number): string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= maximumLength &&
  value === value.trim() &&
  !value.includes("\u0000")
    ? value
    : invalidShelfPersistence()

const nullableText = (value: unknown, maximumLength: number): string | null =>
  value === null ? null : requiredText(value, maximumLength)

const boundedInteger = (
  value: unknown,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER
): number => {
  const parsed = readNonNegativeSafeInteger(value)
  return parsed !== null && parsed >= minimum && parsed <= maximum
    ? parsed
    : invalidShelfPersistence()
}

const requiredBoolean = (value: unknown): boolean =>
  typeof value === "boolean" ? value : invalidShelfPersistence()

const nullableTimestamp = (value: unknown): string | null =>
  value === null ? null : (readIsoTimestamp(value) ?? invalidShelfPersistence())

const optionalTimestamp = (value: unknown): string | null =>
  value === undefined || value === null
    ? null
    : (readIsoTimestamp(value) ?? invalidShelfPersistence())

const enumValue = <T extends string>(
  value: unknown,
  allowed: readonly T[]
): T =>
  typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : invalidShelfPersistence()

const exactKeys = (
  record: UnknownRecord,
  expected: readonly string[]
): void => {
  if (
    Object.keys(record).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(record, key))
  ) {
    invalidShelfPersistence()
  }
}

const singleResult = (value: unknown): UnknownRecord => {
  if (Array.isArray(value)) {
    const parsed = records(value)
    return parsed.length === 1 ? parsed[0]! : invalidShelfPersistence()
  }
  return requiredRecord(value)
}

const unique = (value: string, seen: Set<string>): void => {
  if (seen.has(value)) {
    invalidShelfPersistence()
  }
  seen.add(value)
}

const parseJson = (value: unknown, depth: number): unknown => {
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value
  }
  if (typeof value === "string") {
    return value.length <= 10_000 && !value.includes("\u0000")
      ? value
      : invalidShelfPersistence()
  }
  if (depth >= 6) {
    return invalidShelfPersistence()
  }
  if (Array.isArray(value)) {
    return value.length <= 200
      ? value.map((entry) => parseJson(entry, depth + 1))
      : invalidShelfPersistence()
  }
  const record = asUnknownRecord(value)
  if (!record || Object.keys(record).length > 100) {
    return invalidShelfPersistence()
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => {
      if (
        !key ||
        key.length > 255 ||
        key.includes("\u0000") ||
        FORBIDDEN_JSON_KEYS.has(key)
      ) {
        invalidShelfPersistence()
      }
      return [key, parseJson(entry, depth + 1)]
    })
  )
}

const jsonRecord = (value: unknown): JsonRecord => {
  const parsed = parseJson(value, 0)
  const record = asUnknownRecord(parsed) ?? invalidShelfPersistence()
  let encoded: string
  try {
    encoded = JSON.stringify(record)
  } catch {
    return invalidShelfPersistence()
  }
  return encoded.length <= 20_000 ? record : invalidShelfPersistence()
}

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`
  }
  const record = asUnknownRecord(value)
  if (record) {
    return `{${Object.keys(record)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value) ?? invalidShelfPersistence()
}

const timestampRangeIsValid = (
  startsAt: string | null,
  endsAt: string | null
): boolean =>
  startsAt === null ||
  endsAt === null ||
  Date.parse(endsAt) > Date.parse(startsAt)

const readShelf = (
  value: unknown,
  expectedId?: string
): CatalogShelfRecord | null => {
  if (value === null || value === undefined) {
    return null
  }
  const record = requiredRecord(value)
  const id = requiredIdentifier(record.id, "cshelf_")
  if (expectedId !== undefined && id !== expectedId) {
    return invalidShelfPersistence()
  }
  const handle = requiredText(record.handle, 255)
  const mode = enumValue(record.mode, catalogShelfModeValues)
  const automationType = enumValue(
    record.automation_type,
    catalogShelfAutomationTypeValues
  )
  const startsAt = nullableTimestamp(record.starts_at)
  const endsAt = nullableTimestamp(record.ends_at)
  const archivedAt = nullableTimestamp(record.archived_at)
  const isActive = requiredBoolean(record.is_active)
  const showRibbon = requiredBoolean(record.show_ribbon)
  const ribbonLabel = nullableText(record.ribbon_label, 500)
  if (
    !HANDLE.test(handle) ||
    !timestampRangeIsValid(startsAt, endsAt) ||
    (mode === "automatic" && automationType === "none") ||
    (showRibbon && !ribbonLabel) ||
    (archivedAt !== null && isActive)
  ) {
    return invalidShelfPersistence()
  }
  return {
    archived_at: archivedAt,
    automation_type: automationType,
    created_at: optionalTimestamp(record.created_at),
    description: nullableText(record.description, 10_000),
    ends_at: endsAt,
    handle,
    id,
    is_active: isActive,
    metadata: jsonRecord(record.metadata),
    mode,
    product_limit:
      record.product_limit === null
        ? null
        : boundedInteger(record.product_limit, 1, 200),
    ribbon_label: ribbonLabel,
    ribbon_priority: boundedInteger(record.ribbon_priority, 0, 1_000_000),
    show_ribbon: showRibbon,
    starts_at: startsAt,
    title: requiredText(record.title, 500),
    updated_at: optionalTimestamp(record.updated_at),
    version: boundedInteger(record.version, 1),
  }
}

export const readAdminCatalogShelf = (
  value: unknown,
  expectedId?: string
): CatalogShelfRecord | null => readShelf(value, expectedId)

export const readAdminCatalogShelfList = (
  value: unknown,
  options: { expectedHandle?: string; maximumRows?: number } = {}
): CatalogShelfRecord[] => {
  const raw = records(value)
  if (raw.length > (options.maximumRows ?? 100)) {
    return invalidShelfPersistence()
  }
  const ids = new Set<string>()
  return raw.map((record) => {
    const shelf = readShelf(record) ?? invalidShelfPersistence()
    if (
      options.expectedHandle !== undefined &&
      shelf.handle !== options.expectedHandle
    ) {
      return invalidShelfPersistence()
    }
    unique(shelf.id, ids)
    return shelf
  })
}

export const readAdminCatalogShelfPage = (
  value: unknown,
  maximumRows: number
): { count: number; records: CatalogShelfRecord[] } => {
  let page: ReturnType<typeof readCountedRecordPage>
  try {
    page = readCountedRecordPage(value, "Catalog shelf service")
  } catch {
    return invalidShelfPersistence()
  }
  if (page.records.length > maximumRows) {
    return invalidShelfPersistence()
  }
  const parsed = readAdminCatalogShelfList(page.records, { maximumRows })
  const handles = new Set<string>()
  parsed.forEach((shelf) => {
    unique(shelf.handle, handles)
  })
  return { count: page.count, records: parsed }
}

export const readAdminCatalogShelfMutation = (
  value: unknown,
  expected: {
    fields?: Readonly<Record<string, unknown>>
    id?: string
    version: number
  }
): CatalogShelfRecord => {
  const shelf = readShelf(singleResult(value), expected.id)
  if (!shelf || shelf.version !== expected.version) {
    return invalidShelfPersistence()
  }
  const shelfRecord = requiredRecord(shelf)
  Object.entries(expected.fields ?? {}).forEach(([key, expectedValue]) => {
    const actual = shelfRecord[key]
    const matches =
      expectedValue instanceof Date
        ? actual === expectedValue.toISOString()
        : key === "metadata"
          ? stableJson(actual) === stableJson(jsonRecord(expectedValue))
          : actual === expectedValue
    if (!matches) {
      invalidShelfPersistence()
    }
  })
  return shelf
}

export const readAdminCatalogShelfProducts = (
  value: unknown,
  expectedShelfIds: readonly string[],
  maximumRows = 2_500
): CatalogShelfProductRecord[] => {
  const expected = new Set(expectedShelfIds)
  const raw = records(value)
  if (raw.length > maximumRows) {
    return invalidShelfPersistence()
  }
  const ids = new Set<string>()
  const memberships = new Set<string>()
  return raw.map((record) => {
    const id = requiredIdentifier(record.id, "cshelfp_")
    const shelfId = requiredIdentifier(record.shelf_id, "cshelf_")
    const productId = requiredIdentifier(record.product_id, "prod_")
    const startsAt = nullableTimestamp(record.starts_at)
    const endsAt = nullableTimestamp(record.ends_at)
    if (!expected.has(shelfId) || !timestampRangeIsValid(startsAt, endsAt)) {
      return invalidShelfPersistence()
    }
    unique(id, ids)
    unique(`${shelfId}:${productId}`, memberships)
    return {
      created_at: optionalTimestamp(record.created_at),
      ends_at: endsAt,
      id,
      is_pinned: requiredBoolean(record.is_pinned),
      metadata: jsonRecord(record.metadata),
      product_id: productId,
      product_profile_id: nullableIdentifier(
        record.product_profile_id,
        "cprof_"
      ),
      shelf_id: shelfId,
      sort_order: boundedInteger(record.sort_order, 0, 1_000_000),
      starts_at: startsAt,
      updated_at: optionalTimestamp(record.updated_at),
    }
  })
}

export type ExpectedShelfProduct = {
  ends_at: Date | null
  is_pinned: boolean
  metadata: Record<string, unknown>
  product_id: string
  product_profile_id: string | null
  sort_order: number
  starts_at: Date | null
}

export const readExactAdminCatalogShelfProducts = (
  value: unknown,
  shelfId: string,
  expectedProducts: readonly ExpectedShelfProduct[]
): CatalogShelfProductRecord[] => {
  const parsed = readAdminCatalogShelfProducts(value, [shelfId], 200)
  if (parsed.length !== expectedProducts.length) {
    return invalidShelfPersistence()
  }
  const expectedByProductId = new Map(
    expectedProducts.map((product) => [product.product_id, product])
  )
  parsed.forEach((product) => {
    const expected = expectedByProductId.get(product.product_id)
    if (
      !expected ||
      product.product_profile_id !== expected.product_profile_id ||
      product.sort_order !== expected.sort_order ||
      product.is_pinned !== expected.is_pinned ||
      (product.starts_at !== expected.starts_at?.toISOString() &&
        !(product.starts_at === null && expected.starts_at === null)) ||
      (product.ends_at !== expected.ends_at?.toISOString() &&
        !(product.ends_at === null && expected.ends_at === null)) ||
      stableJson(product.metadata) !== stableJson(jsonRecord(expected.metadata))
    ) {
      invalidShelfPersistence()
    }
  })
  return parsed
}

export const readAdminCatalogProductProfiles = (
  value: unknown,
  expectedIds: readonly string[]
): Pick<CatalogProductProfileRecord, "id" | "product_id">[] => {
  const expected = new Set(expectedIds)
  const raw = records(value)
  if (raw.length > expected.size) {
    return invalidShelfPersistence()
  }
  const seen = new Set<string>()
  return raw.map((record) => {
    const id = requiredIdentifier(record.id, "cprof_")
    if (!expected.has(id)) {
      return invalidShelfPersistence()
    }
    unique(id, seen)
    return {
      id,
      product_id: requiredIdentifier(record.product_id, "prod_"),
    }
  })
}

export type ShelfOperationExpectation = {
  actorId: string | null
  aggregateId: string
  command: string
  expectedVersion: number
  id?: string
  idempotencyKey: string
  requestSha256: string
  status: "pending" | "succeeded"
}

export type ShelfOperationProjection = {
  actorId: string | null
  aggregateId: string
  command: string
  expectedVersion: number
  id: string
  idempotencyKey: string
  requestSha256: string
  result: UnknownRecord
  status: "pending" | "succeeded"
}

const readShelfOperation = (value: unknown): ShelfOperationProjection => {
  const record = requiredRecord(value)
  const actorId =
    record.actor_id === null ? null : requiredText(record.actor_id, 255)
  const requestSha256 = requiredText(record.request_sha256, 64)
  const idempotencyKey = requiredText(record.idempotency_key, 255)
  const status = enumValue(record.status, ["pending", "succeeded"] as const)
  const result = requiredRecord(record.result)
  const completedAt = optionalTimestamp(record.completed_at)
  jsonRecord(record.metadata)
  if (
    !SHA256.test(requestSha256) ||
    !UUID.test(idempotencyKey) ||
    record.error_code !== null ||
    record.error_detail !== null ||
    (status === "pending" &&
      (completedAt !== null || Object.keys(result).length !== 0)) ||
    (status === "succeeded" && completedAt === null)
  ) {
    return invalidShelfPersistence()
  }
  return {
    actorId,
    aggregateId: requiredText(record.aggregate_id, 500),
    command: requiredText(record.command, 255),
    expectedVersion: boundedInteger(record.expected_version, 0),
    id: requiredIdentifier(record.id, "catop_"),
    idempotencyKey,
    requestSha256,
    result,
    status,
  }
}

export const readShelfOperationList = (
  value: unknown
): ShelfOperationProjection | null => {
  const parsed = records(value)
  if (parsed.length > 1) {
    return invalidShelfPersistence()
  }
  return parsed[0] ? readShelfOperation(parsed[0]) : null
}

export const readShelfOperationMutation = (
  value: unknown,
  expected: ShelfOperationExpectation
): ShelfOperationProjection => {
  const operation = readShelfOperation(singleResult(value))
  if (
    operation.actorId !== expected.actorId ||
    operation.aggregateId !== expected.aggregateId ||
    operation.command !== expected.command ||
    operation.expectedVersion !== expected.expectedVersion ||
    (expected.id !== undefined && operation.id !== expected.id) ||
    operation.idempotencyKey !== expected.idempotencyKey ||
    operation.requestSha256 !== expected.requestSha256 ||
    operation.status !== expected.status
  ) {
    return invalidShelfPersistence()
  }
  return operation
}

export type ShelfUpsertOperationResult = {
  created: boolean
  shelfId: string
  version: number
}

export const readShelfUpsertOperationResult = (
  value: unknown
): ShelfUpsertOperationResult => {
  const result = requiredRecord(value)
  exactKeys(result, ["created", "shelfId", "version"])
  return {
    created: requiredBoolean(result.created),
    shelfId: requiredIdentifier(result.shelfId, "cshelf_"),
    version: boundedInteger(result.version, 1),
  }
}

export type ShelfLifecycleOperationResult = {
  archived: boolean
  shelfId: string
  version: number
}

export const readShelfLifecycleOperationResult = (
  value: unknown
): ShelfLifecycleOperationResult => {
  const result = requiredRecord(value)
  exactKeys(result, ["archived", "shelfId", "version"])
  return {
    archived: requiredBoolean(result.archived),
    shelfId: requiredIdentifier(result.shelfId, "cshelf_"),
    version: boundedInteger(result.version, 1),
  }
}
