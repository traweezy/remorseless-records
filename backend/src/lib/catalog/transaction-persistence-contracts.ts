import { MedusaError } from "@medusajs/framework/utils"

import {
  catalogBundleFulfillmentModeValues,
  catalogBundleInventoryModeValues,
  catalogBundleTypeValues,
  catalogMediaDerivativeStatusValues,
  catalogMediaLifecycleStatusValues,
  catalogMediaRoleValues,
  type CatalogBundleProfileRecord,
  type CatalogMediaDerivativeStatus,
  type CatalogMediaAssetRecord,
  type CatalogMediaLifecycleStatus,
  type CatalogMediaRole,
  type CatalogProductMediaItemRecord,
  type JsonRecord,
} from "@/modules/catalog/serializers"
import type {
  CatalogBundleComponentState,
  CatalogBundleInventoryLinkState,
  CatalogBundleProfileState,
  CatalogBundleStateSnapshot,
  JsonObject,
} from "@/modules/catalog/bundle-authoring"

import {
  readIsoTimestamp,
  readNonNegativeSafeInteger,
} from "../provider-boundary/primitives"
import {
  asUnknownRecord,
  readRecordArray,
  type UnknownRecord,
} from "../provider-boundary/records"

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,254}$/u
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const SHA256 = /^[a-f0-9]{64}$/u
const FORBIDDEN_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"])

const invalidTransactionPersistence = (): never => {
  throw new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    "The catalog transaction persistence boundary returned invalid structured data."
  )
}

const record = (value: unknown): UnknownRecord =>
  asUnknownRecord(value) ?? invalidTransactionPersistence()

const rows = (value: unknown): UnknownRecord[] => {
  try {
    return readRecordArray(value, { context: "Catalog transaction service" })
  } catch {
    return invalidTransactionPersistence()
  }
}

const single = (value: unknown): UnknownRecord => {
  if (!Array.isArray(value)) {
    return record(value)
  }
  const parsed = rows(value)
  return parsed.length === 1 ? parsed[0]! : invalidTransactionPersistence()
}

const identifier = (value: unknown, prefix?: string): string =>
  typeof value === "string" &&
  value === value.trim() &&
  IDENTIFIER.test(value) &&
  (prefix === undefined || value.startsWith(prefix))
    ? value
    : invalidTransactionPersistence()

const nullableIdentifier = (value: unknown, prefix?: string): string | null =>
  value === null ? null : identifier(value, prefix)

const text = (value: unknown, maximum: number): string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= maximum &&
  value === value.trim() &&
  !value.includes("\u0000")
    ? value
    : invalidTransactionPersistence()

const nullableText = (value: unknown, maximum: number): string | null =>
  value === null ? null : text(value, maximum)

const boolean = (value: unknown): boolean =>
  typeof value === "boolean" ? value : invalidTransactionPersistence()

const integer = (value: unknown, minimum: number, maximum: number): number => {
  const parsed = readNonNegativeSafeInteger(value)
  return parsed !== null && parsed >= minimum && parsed <= maximum
    ? parsed
    : invalidTransactionPersistence()
}

const finiteNumber = (
  value: unknown,
  minimum: number,
  maximum: number
): number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= minimum &&
  value <= maximum
    ? value
    : invalidTransactionPersistence()

const nullableInteger = (
  value: unknown,
  minimum: number,
  maximum: number
): number | null => (value === null ? null : integer(value, minimum, maximum))

const nullableFiniteNumber = (
  value: unknown,
  minimum: number,
  maximum: number
): number | null =>
  value === null ? null : finiteNumber(value, minimum, maximum)

const timestamp = (value: unknown): string | null =>
  value === null
    ? null
    : (readIsoTimestamp(value) ?? invalidTransactionPersistence())

const optionalTimestamp = (value: unknown): string | null =>
  value === null || value === undefined
    ? null
    : (readIsoTimestamp(value) ?? invalidTransactionPersistence())

const httpUrl = (value: unknown): string => {
  const parsed = text(value, 2_048)
  try {
    return ["http:", "https:"].includes(new URL(parsed).protocol)
      ? parsed
      : invalidTransactionPersistence()
  } catch {
    return invalidTransactionPersistence()
  }
}

const nullableSha256 = (value: unknown): string | null => {
  if (value === null) {
    return null
  }
  const parsed = text(value, 64)
  return SHA256.test(parsed) ? parsed : invalidTransactionPersistence()
}

const enumValue = <T extends string>(
  value: unknown,
  values: readonly T[]
): T =>
  typeof value === "string" && values.includes(value as T)
    ? (value as T)
    : invalidTransactionPersistence()

const unique = (value: string, seen: Set<string>): void => {
  if (seen.has(value)) {
    invalidTransactionPersistence()
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
      : invalidTransactionPersistence()
  }
  if (depth >= 8) {
    return invalidTransactionPersistence()
  }
  if (Array.isArray(value)) {
    return value.length <= 500
      ? value.map((entry) => parseJson(entry, depth + 1))
      : invalidTransactionPersistence()
  }
  const parsed = asUnknownRecord(value)
  if (!parsed || Object.keys(parsed).length > 200) {
    return invalidTransactionPersistence()
  }
  return Object.fromEntries(
    Object.entries(parsed).map(([key, entry]) => {
      if (
        !key ||
        key.length > 255 ||
        key.includes("\u0000") ||
        FORBIDDEN_JSON_KEYS.has(key)
      ) {
        invalidTransactionPersistence()
      }
      return [key, parseJson(entry, depth + 1)]
    })
  )
}

const jsonRecord = (value: unknown): JsonRecord => {
  const parsed = asUnknownRecord(parseJson(value, 0))
  if (!parsed || JSON.stringify(parsed).length > 100_000) {
    return invalidTransactionPersistence()
  }
  return parsed
}

const comparable = (value: unknown): unknown => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? invalidTransactionPersistence()
      : value.toISOString()
  }
  if (Array.isArray(value)) {
    return value.map(comparable)
  }
  const parsed = asUnknownRecord(value)
  return parsed
    ? Object.fromEntries(
        Object.keys(parsed)
          .sort()
          .map((key) => [key, comparable(parsed[key])])
      )
    : value
}

const stableJson = (value: unknown): string => JSON.stringify(comparable(value))

const assertExpectedFields = (
  actual: Readonly<Record<string, unknown>>,
  expected: Readonly<Record<string, unknown>>
): void => {
  if (
    Object.entries(expected).some(
      ([key, value]) => stableJson(actual[key]) !== stableJson(value)
    )
  ) {
    invalidTransactionPersistence()
  }
}

export type CatalogMediaAssetPersistenceRecord = Omit<
  CatalogMediaAssetRecord,
  "derivative_status" | "derivatives" | "lifecycle_status" | "metadata"
> & {
  derivative_status: CatalogMediaDerivativeStatus
  derivatives: JsonRecord
  lifecycle_status: CatalogMediaLifecycleStatus
  metadata: JsonRecord
}

const mediaAssetRecord = (
  value: unknown
): CatalogMediaAssetPersistenceRecord => {
  const source = record(value)
  const lifecycleStatus = enumValue(
    source.lifecycle_status,
    catalogMediaLifecycleStatusValues
  )
  const quarantinedAt = timestamp(source.quarantined_at)
  const purgeEligibleAt = timestamp(source.purge_eligible_at)
  const quarantinedBy = nullableText(source.quarantined_by, 255)
  if (
    (lifecycleStatus === "active" &&
      (quarantinedAt !== null ||
        purgeEligibleAt !== null ||
        quarantinedBy !== null)) ||
    (lifecycleStatus === "quarantined" &&
      (quarantinedAt === null || purgeEligibleAt === null))
  ) {
    return invalidTransactionPersistence()
  }
  optionalTimestamp(source.created_at)
  optionalTimestamp(source.updated_at)
  return {
    alt_text: nullableText(source.alt_text, 2_000),
    byte_size: nullableInteger(source.byte_size, 0, 100_000_000),
    caption: nullableText(source.caption, 10_000),
    content_sha256: nullableSha256(source.content_sha256),
    crop_intent: nullableText(source.crop_intent, 255),
    derivative_status: enumValue(
      source.derivative_status,
      catalogMediaDerivativeStatusValues
    ),
    derivatives: jsonRecord(source.derivatives),
    focal_x: nullableFiniteNumber(source.focal_x, 0, 1),
    focal_y: nullableFiniteNumber(source.focal_y, 0, 1),
    height: nullableInteger(source.height, 1, 100_000),
    id: identifier(source.id, "cmedia_"),
    lifecycle_status: lifecycleStatus,
    metadata: jsonRecord(source.metadata),
    mime_type: nullableText(source.mime_type, 255),
    original_filename: nullableText(source.original_filename, 255),
    purge_eligible_at: purgeEligibleAt,
    quarantined_at: quarantinedAt,
    quarantined_by: quarantinedBy,
    source_file_key: nullableText(source.source_file_key, 1_024),
    source_url: httpUrl(source.source_url),
    version: integer(source.version, 1, Number.MAX_SAFE_INTEGER),
    width: nullableInteger(source.width, 1, 100_000),
  }
}

export const readCatalogMediaAsset = (
  value: unknown,
  expectedId?: string
): CatalogMediaAssetPersistenceRecord => {
  const asset = mediaAssetRecord(value)
  if (expectedId !== undefined && asset.id !== expectedId) {
    invalidTransactionPersistence()
  }
  return asset
}

export const readCatalogMediaAssets = (
  value: unknown,
  options: {
    expectedIds?: readonly string[]
    expectedLifecycleStatus?: CatalogMediaLifecycleStatus
    maximumRows?: number
    requireExactIds?: boolean
  } = {}
): CatalogMediaAssetPersistenceRecord[] => {
  const source = rows(value)
  const maximumRows = options.maximumRows ?? 100
  if (source.length > maximumRows) {
    return invalidTransactionPersistence()
  }
  const expected = options.expectedIds ? new Set(options.expectedIds) : null
  const seen = new Set<string>()
  const assets = source.map((entry) => {
    const asset = mediaAssetRecord(entry)
    unique(asset.id, seen)
    if (expected && !expected.has(asset.id)) {
      invalidTransactionPersistence()
    }
    if (
      options.expectedLifecycleStatus !== undefined &&
      asset.lifecycle_status !== options.expectedLifecycleStatus
    ) {
      invalidTransactionPersistence()
    }
    return asset
  })
  if (
    expected &&
    options.requireExactIds === true &&
    (seen.size !== expected.size || [...expected].some((id) => !seen.has(id)))
  ) {
    return invalidTransactionPersistence()
  }
  return assets
}

export const readCatalogMediaAssetMutation = (
  value: unknown,
  expected: Readonly<Record<string, unknown>>
): CatalogMediaAssetPersistenceRecord => {
  const asset = mediaAssetRecord(single(value))
  assertExpectedFields(asset as unknown as UnknownRecord, expected)
  return asset
}

export type CatalogProductMediaItemPersistenceRecord = Omit<
  CatalogProductMediaItemRecord,
  "metadata" | "role"
> & {
  metadata: JsonRecord
  role: CatalogMediaRole
}

const productMediaItemRecord = (
  value: unknown
): CatalogProductMediaItemPersistenceRecord => {
  const source = record(value)
  optionalTimestamp(source.created_at)
  optionalTimestamp(source.updated_at)
  return {
    id: identifier(source.id, "cpmedia_"),
    is_primary: boolean(source.is_primary),
    media_asset_id: identifier(source.media_asset_id, "cmedia_"),
    metadata: jsonRecord(source.metadata),
    product_id: identifier(source.product_id, "prod_"),
    product_profile_id: nullableIdentifier(source.product_profile_id, "cprof_"),
    role: enumValue(source.role, catalogMediaRoleValues),
    sort_order: integer(source.sort_order, 0, 10_000),
    variant_id: nullableIdentifier(source.variant_id, "variant_"),
  }
}

export type ProductMediaItemQueryExpectation = {
  mediaAssetId?: string
  productId?: string
}

export const readCatalogProductMediaItems = (
  value: unknown,
  expected: ProductMediaItemQueryExpectation,
  maximumRows = 100
): CatalogProductMediaItemPersistenceRecord[] => {
  const source = rows(value)
  if (source.length > maximumRows) {
    return invalidTransactionPersistence()
  }
  const seen = new Set<string>()
  return source.map((entry) => {
    const item = productMediaItemRecord(entry)
    unique(item.id, seen)
    if (
      (expected.mediaAssetId !== undefined &&
        item.media_asset_id !== expected.mediaAssetId) ||
      (expected.productId !== undefined &&
        item.product_id !== expected.productId)
    ) {
      return invalidTransactionPersistence()
    }
    return item
  })
}

export const readExactCatalogProductMediaItems = (
  value: unknown,
  expectedProductId: string,
  expected: readonly Readonly<Record<string, unknown>>[]
): CatalogProductMediaItemPersistenceRecord[] => {
  const items = readCatalogProductMediaItems(
    value,
    { productId: expectedProductId },
    expected.length
  )
  if (items.length !== expected.length) {
    return invalidTransactionPersistence()
  }
  const unmatched = [...items]
  for (const expectation of expected) {
    const index = unmatched.findIndex((item) => {
      try {
        assertExpectedFields(item as unknown as UnknownRecord, expectation)
        return true
      } catch {
        return false
      }
    })
    if (index < 0) {
      return invalidTransactionPersistence()
    }
    unmatched.splice(index, 1)
  }
  return items
}

export type CatalogTransactionOperationStatus =
  | "compensated"
  | "failed"
  | "pending"
  | "succeeded"

export type CatalogTransactionOperation = {
  actorId: string | null
  aggregateId: string
  command: string
  errorCode: string | null
  errorDetail: string | null
  expectedVersion: number
  id: string
  idempotencyKey: string
  metadata: JsonRecord
  requestSha256: string
  result: JsonRecord
  status: CatalogTransactionOperationStatus
}

export type CatalogTransactionOperationExpectation = Omit<
  CatalogTransactionOperation,
  "errorCode" | "errorDetail" | "id" | "metadata" | "result"
> & {
  errorCode?: string | null
  id?: string
  metadata?: Readonly<Record<string, unknown>>
  result?: Readonly<Record<string, unknown>>
}

const operationRecord = (value: unknown): CatalogTransactionOperation => {
  const source = record(value)
  const status = enumValue(source.status, [
    "compensated",
    "failed",
    "pending",
    "succeeded",
  ] as const)
  const completedAt = optionalTimestamp(source.completed_at)
  const errorCode =
    source.error_code === null ? null : text(source.error_code, 255)
  const errorDetail =
    source.error_detail === null ? null : text(source.error_detail, 2_000)
  const result = jsonRecord(source.result)
  const idempotencyKey = text(source.idempotency_key, 255)
  const requestSha256 = text(source.request_sha256, 64)
  if (
    !UUID.test(idempotencyKey) ||
    !SHA256.test(requestSha256) ||
    (status === "pending" &&
      (completedAt !== null ||
        errorCode !== null ||
        errorDetail !== null ||
        Object.keys(result).length !== 0)) ||
    (status === "succeeded" &&
      (completedAt === null || errorCode !== null || errorDetail !== null)) ||
    (status === "compensated" &&
      (completedAt === null ||
        errorCode !== "workflow_compensated" ||
        errorDetail === null)) ||
    (status === "failed" &&
      (completedAt === null || errorCode === null || errorDetail === null))
  ) {
    return invalidTransactionPersistence()
  }
  return {
    actorId: source.actor_id === null ? null : text(source.actor_id, 255),
    aggregateId: identifier(source.aggregate_id),
    command: text(source.command, 255),
    errorCode,
    errorDetail,
    expectedVersion: integer(
      source.expected_version,
      0,
      Number.MAX_SAFE_INTEGER
    ),
    id: identifier(source.id, "catop_"),
    idempotencyKey,
    metadata: jsonRecord(source.metadata),
    requestSha256,
    result,
    status,
  }
}

export const readCatalogTransactionOperationList = (
  value: unknown
): CatalogTransactionOperation | null => {
  const source = rows(value)
  if (source.length > 1) {
    return invalidTransactionPersistence()
  }
  return source[0] ? operationRecord(source[0]) : null
}

export const readCatalogTransactionOperationMutation = (
  value: unknown,
  expected: CatalogTransactionOperationExpectation
): CatalogTransactionOperation => {
  const operation = operationRecord(single(value))
  if (
    operation.actorId !== expected.actorId ||
    operation.aggregateId !== expected.aggregateId ||
    operation.command !== expected.command ||
    (typeof expected.errorCode === "string" &&
      operation.errorCode !== expected.errorCode) ||
    operation.expectedVersion !== expected.expectedVersion ||
    (expected.id !== undefined && operation.id !== expected.id) ||
    operation.idempotencyKey !== expected.idempotencyKey ||
    operation.requestSha256 !== expected.requestSha256 ||
    operation.status !== expected.status ||
    (expected.metadata !== undefined &&
      stableJson(operation.metadata) !==
        stableJson(jsonRecord(expected.metadata))) ||
    (expected.result !== undefined &&
      stableJson(operation.result) !== stableJson(jsonRecord(expected.result)))
  ) {
    return invalidTransactionPersistence()
  }
  return operation
}

const exactKeys = (value: UnknownRecord, keys: readonly string[]): void => {
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  ) {
    invalidTransactionPersistence()
  }
}

export type CatalogProductMediaOperationResult = {
  productId: string
  version: number
}

export const readCatalogProductMediaOperationResult = (
  value: unknown,
  expectedProductId?: string
): CatalogProductMediaOperationResult => {
  const source = record(value)
  exactKeys(source, ["productId", "version"])
  const productId = identifier(source.productId, "prod_")
  if (expectedProductId !== undefined && productId !== expectedProductId) {
    return invalidTransactionPersistence()
  }
  return {
    productId,
    version: integer(source.version, 1, Number.MAX_SAFE_INTEGER),
  }
}

export type CatalogMediaLifecycleOperationResult = {
  assetId: string
  lifecycleStatus: "active" | "quarantined"
  purgeEligibleAt: string | null
  quarantinedAt: string | null
  version: number
}

export const readCatalogMediaLifecycleOperationResult = (
  value: unknown,
  expectedAssetId?: string
): CatalogMediaLifecycleOperationResult => {
  const source = record(value)
  exactKeys(source, [
    "assetId",
    "lifecycleStatus",
    "purgeEligibleAt",
    "quarantinedAt",
    "version",
  ])
  const assetId = identifier(source.assetId, "cmedia_")
  const lifecycleStatus = enumValue(
    source.lifecycleStatus,
    catalogMediaLifecycleStatusValues
  )
  const purgeEligibleAt = timestamp(source.purgeEligibleAt)
  const quarantinedAt = timestamp(source.quarantinedAt)
  if (
    (expectedAssetId !== undefined && assetId !== expectedAssetId) ||
    (lifecycleStatus === "active" &&
      (purgeEligibleAt !== null || quarantinedAt !== null)) ||
    (lifecycleStatus === "quarantined" &&
      (purgeEligibleAt === null || quarantinedAt === null))
  ) {
    return invalidTransactionPersistence()
  }
  return {
    assetId,
    lifecycleStatus,
    purgeEligibleAt,
    quarantinedAt,
    version: integer(source.version, 1, Number.MAX_SAFE_INTEGER),
  }
}

export type CatalogMediaUploadResultFileBoundary = {
  filename: string
  id: string
  mediaAssetId: string
  mimeType: string
  size: number
  url: string
}

const uploadResultFile = (
  value: unknown
): CatalogMediaUploadResultFileBoundary => {
  const source = record(value)
  exactKeys(source, [
    "filename",
    "id",
    "mediaAssetId",
    "mimeType",
    "size",
    "url",
  ])
  return {
    filename: text(source.filename, 255),
    id: identifier(source.id),
    mediaAssetId: identifier(source.mediaAssetId, "cmedia_"),
    mimeType: text(source.mimeType, 255),
    size: integer(source.size, 0, 100_000_000),
    url: httpUrl(source.url),
  }
}

export const readCatalogMediaUploadOperationResult = (
  value: unknown,
  expectedFiles?: readonly Readonly<{
    filename: string
    mimeType: string
    size: number
  }>[]
): CatalogMediaUploadResultFileBoundary[] => {
  const source = record(value)
  exactKeys(source, ["files"])
  const fileRows = Array.isArray(source.files)
    ? source.files
    : invalidTransactionPersistence()
  if (fileRows.length > 10) {
    return invalidTransactionPersistence()
  }
  const seenFileIds = new Set<string>()
  const seenAssetIds = new Set<string>()
  const files = fileRows.map((entry) => {
    const file = uploadResultFile(entry)
    unique(file.id, seenFileIds)
    unique(file.mediaAssetId, seenAssetIds)
    return file
  })
  if (
    expectedFiles &&
    (files.length !== expectedFiles.length ||
      files.some((file, index) => {
        const expected = expectedFiles[index]
        return (
          !expected ||
          file.filename !== expected.filename ||
          file.mimeType !== expected.mimeType ||
          file.size !== expected.size
        )
      }))
  ) {
    return invalidTransactionPersistence()
  }
  return files
}

export const readCatalogUploadedFile = (
  value: unknown
): { id: string; url: string } => {
  const source = record(value)
  return { id: identifier(source.id), url: httpUrl(source.url) }
}

const bundleProfileRecord = (value: unknown): CatalogBundleProfileState => {
  const source = record(value)
  optionalTimestamp(source.created_at)
  optionalTimestamp(source.updated_at)
  return {
    bundle_type: enumValue(source.bundle_type, catalogBundleTypeValues),
    description_html: nullableText(source.description_html, 100_000),
    display_title: nullableText(source.display_title, 1_000),
    fulfillment_mode: enumValue(
      source.fulfillment_mode,
      catalogBundleFulfillmentModeValues
    ),
    id: identifier(source.id, "cbundle_"),
    inventory_mode: enumValue(
      source.inventory_mode,
      catalogBundleInventoryModeValues
    ),
    is_active: boolean(source.is_active),
    metadata: jsonRecord(source.metadata),
    product_id: identifier(source.product_id, "prod_"),
    product_profile_id: nullableIdentifier(source.product_profile_id, "cprof_"),
    version: integer(source.version, 1, Number.MAX_SAFE_INTEGER),
  }
}

export const readCatalogBundleStateProfiles = (
  value: unknown,
  expectedProductId: string
): CatalogBundleProfileState[] => {
  const source = rows(value)
  if (source.length > 1) {
    return invalidTransactionPersistence()
  }
  return source.map((entry) => {
    const profile = bundleProfileRecord(entry)
    return profile.product_id === expectedProductId
      ? profile
      : invalidTransactionPersistence()
  })
}

export const readCatalogBundleStatePage = (
  value: unknown,
  options: { expectedProductId?: string; maximumRows: number }
): { count: number; rows: CatalogBundleProfileState[] } => {
  if (!Array.isArray(value) || value.length !== 2) {
    return invalidTransactionPersistence()
  }
  const profileRows = rows(value[0])
  const count = integer(value[1], 0, Number.MAX_SAFE_INTEGER)
  if (profileRows.length > options.maximumRows || count < profileRows.length) {
    return invalidTransactionPersistence()
  }
  const seen = new Set<string>()
  const parsed = profileRows.map((entry) => {
    const profile = bundleProfileRecord(entry)
    unique(profile.id, seen)
    if (
      options.expectedProductId !== undefined &&
      profile.product_id !== options.expectedProductId
    ) {
      invalidTransactionPersistence()
    }
    return profile
  })
  return { count, rows: parsed }
}

export const readCatalogBundleProfileMutation = (
  value: unknown,
  expected: Readonly<Record<string, unknown>>
): CatalogBundleProfileState => {
  const profile = bundleProfileRecord(single(value))
  assertExpectedFields(profile as unknown as UnknownRecord, expected)
  return profile
}

const bundleComponentRecord = (value: unknown): CatalogBundleComponentState => {
  const source = record(value)
  optionalTimestamp(source.created_at)
  optionalTimestamp(source.updated_at)
  return {
    bundle_profile_id: identifier(source.bundle_profile_id, "cbundle_"),
    component_inventory_item_id: nullableIdentifier(
      source.component_inventory_item_id
    ),
    component_product_id: identifier(source.component_product_id, "prod_"),
    component_variant_id: nullableIdentifier(
      source.component_variant_id,
      "variant_"
    ),
    id: identifier(source.id, "cbcomp_"),
    is_required: boolean(source.is_required),
    metadata: jsonRecord(source.metadata),
    quantity: integer(source.quantity, 1, 10_000),
    sku: nullableText(source.sku, 255),
    sort_order: integer(source.sort_order, 0, 10_000),
    title: nullableText(source.title, 1_000),
    variant_title: nullableText(source.variant_title, 1_000),
  }
}

export const readCatalogBundleComponentStates = (
  value: unknown,
  expectedProfileId: string,
  maximumRows = 100
): CatalogBundleComponentState[] => {
  const source = rows(value)
  if (source.length > maximumRows) {
    return invalidTransactionPersistence()
  }
  const seen = new Set<string>()
  return source.map((entry) => {
    const component = bundleComponentRecord(entry)
    unique(component.id, seen)
    return component.bundle_profile_id === expectedProfileId
      ? component
      : invalidTransactionPersistence()
  })
}

export const readExactCatalogBundleComponents = (
  value: unknown,
  expectedProfileId: string,
  expected: readonly Readonly<Record<string, unknown>>[]
): CatalogBundleComponentState[] => {
  const components = readCatalogBundleComponentStates(
    value,
    expectedProfileId,
    expected.length
  )
  if (components.length !== expected.length) {
    return invalidTransactionPersistence()
  }
  const unmatched = [...components]
  for (const expectation of expected) {
    const index = unmatched.findIndex((component) => {
      try {
        assertExpectedFields(component as unknown as UnknownRecord, expectation)
        return true
      } catch {
        return false
      }
    })
    if (index < 0) {
      return invalidTransactionPersistence()
    }
    unmatched.splice(index, 1)
  }
  return components
}

export type CatalogBundleInventoryLinkPersistenceRecord =
  Required<CatalogBundleInventoryLinkState>

const bundleInventoryLinkRecord = (
  value: unknown
): CatalogBundleInventoryLinkPersistenceRecord => {
  const source = record(value)
  optionalTimestamp(source.created_at)
  optionalTimestamp(source.updated_at)
  return {
    bundle_profile_id: identifier(source.bundle_profile_id, "cbundle_"),
    bundle_variant_id: identifier(source.bundle_variant_id, "variant_"),
    id: identifier(source.id, "cbilink_"),
    inventory_item_id: identifier(source.inventory_item_id),
    metadata: jsonRecord(source.metadata),
    required_quantity: integer(source.required_quantity, 1, 1_000_000),
  }
}

export const readExactCatalogBundleInventoryLinks = (
  value: unknown,
  expectedProfileId: string,
  expected: readonly CatalogBundleInventoryLinkState[]
): CatalogBundleInventoryLinkPersistenceRecord[] => {
  const links = readCatalogBundleInventoryLinks(
    value,
    expectedProfileId,
    expected.length
  )
  if (links.length !== expected.length) {
    return invalidTransactionPersistence()
  }
  const unmatched = [...links]
  for (const expectation of expected) {
    const index = unmatched.findIndex(
      (link) =>
        (expectation.id === undefined || link.id === expectation.id) &&
        link.bundle_profile_id === expectation.bundle_profile_id &&
        link.bundle_variant_id === expectation.bundle_variant_id &&
        link.inventory_item_id === expectation.inventory_item_id &&
        link.required_quantity === expectation.required_quantity &&
        stableJson(link.metadata) ===
          stableJson(jsonRecord(expectation.metadata))
    )
    if (index < 0) {
      return invalidTransactionPersistence()
    }
    unmatched.splice(index, 1)
  }
  return links
}

export const readCatalogBundleInventoryLinks = (
  value: unknown,
  expectedProfileId: string,
  maximumRows = 100
): CatalogBundleInventoryLinkPersistenceRecord[] => {
  const source = rows(value)
  if (source.length > maximumRows) {
    return invalidTransactionPersistence()
  }
  const seenIds = new Set<string>()
  const seenLinks = new Set<string>()
  return source.map((entry) => {
    const link = bundleInventoryLinkRecord(entry)
    unique(link.id, seenIds)
    unique(`${link.bundle_variant_id}:${link.inventory_item_id}`, seenLinks)
    return link.bundle_profile_id === expectedProfileId
      ? link
      : invalidTransactionPersistence()
  })
}

export const assertExactCatalogBundleSnapshot = (
  actual: CatalogBundleStateSnapshot,
  expected: CatalogBundleStateSnapshot
): void => {
  if (
    stableJson(actual.profile) !== stableJson(expected.profile) ||
    stableJson(
      actual.components
        .map((component) => comparable(component))
        .sort((left, right) =>
          stableJson(left).localeCompare(stableJson(right))
        )
    ) !==
      stableJson(
        expected.components
          .map((component) => comparable(component))
          .sort((left, right) =>
            stableJson(left).localeCompare(stableJson(right))
          )
      )
  ) {
    invalidTransactionPersistence()
  }
}

export type CatalogBundleOperationResult = {
  deleted: boolean
  productId: string
  profileId: string | null
  version: number
}

export const readCatalogBundleOperationResult = (
  value: unknown,
  expectedProductId?: string
): CatalogBundleOperationResult => {
  const source = record(value)
  exactKeys(source, ["deleted", "productId", "profileId", "version"])
  const productId = identifier(source.productId, "prod_")
  const profileId = nullableIdentifier(source.profileId, "cbundle_")
  const deleted = boolean(source.deleted)
  if (
    (expectedProductId !== undefined && productId !== expectedProductId) ||
    deleted !== (profileId === null)
  ) {
    return invalidTransactionPersistence()
  }
  return {
    deleted,
    productId,
    profileId,
    version: integer(source.version, 1, Number.MAX_SAFE_INTEGER),
  }
}

export const asCatalogBundleProfileRecord = (
  profile: CatalogBundleProfileState
): CatalogBundleProfileRecord => profile

export const asCatalogBundleJsonObject = (value: unknown): JsonObject =>
  jsonRecord(value)
