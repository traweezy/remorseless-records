import { MedusaError } from "@medusajs/framework/utils"

import { sanitizeRichTextHtml } from "@/lib/content/rich-text"
import {
  catalogAvailabilityStatusValues,
  catalogReferenceKindValues,
  catalogReleaseDatePrecisionValues,
  type CatalogArtistRecord,
  type CatalogProductArtistRecord,
  type CatalogProductProfileRecord,
  type CatalogProductReferenceRecord,
  type CatalogReferenceValueRecord,
  type CatalogVariantProfileRecord,
  type JsonList,
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
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const SHA256 = /^[a-f0-9]{64}$/u
const FORBIDDEN_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"])

const invalidProfilePersistence = (): never => {
  throw new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    "The catalog profile persistence boundary returned invalid structured data."
  )
}

const record = (value: unknown): UnknownRecord =>
  asUnknownRecord(value) ?? invalidProfilePersistence()

const rows = (value: unknown): UnknownRecord[] => {
  try {
    return readRecordArray(value, { context: "Catalog profile service" })
  } catch {
    return invalidProfilePersistence()
  }
}

const single = (value: unknown): UnknownRecord => {
  if (Array.isArray(value)) {
    const parsed = rows(value)
    return parsed.length === 1 ? parsed[0]! : invalidProfilePersistence()
  }
  return record(value)
}

const identifier = (value: unknown, prefix?: string): string =>
  typeof value === "string" &&
  value === value.trim() &&
  IDENTIFIER.test(value) &&
  (prefix === undefined || value.startsWith(prefix))
    ? value
    : invalidProfilePersistence()

const nullableIdentifier = (value: unknown, prefix?: string): string | null =>
  value === null ? null : identifier(value, prefix)

const text = (value: unknown, maximum: number): string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= maximum &&
  value === value.trim() &&
  !value.includes("\u0000")
    ? value
    : invalidProfilePersistence()

const nullableText = (value: unknown, maximum: number): string | null =>
  value === null ? null : text(value, maximum)

const integer = (value: unknown, minimum: number, maximum: number): number => {
  const parsed = readNonNegativeSafeInteger(value)
  return parsed !== null && parsed >= minimum && parsed <= maximum
    ? parsed
    : invalidProfilePersistence()
}

const boolean = (value: unknown): boolean =>
  typeof value === "boolean" ? value : invalidProfilePersistence()

const timestamp = (value: unknown): string | null =>
  value === null
    ? null
    : (readIsoTimestamp(value) ?? invalidProfilePersistence())

const optionalTimestamp = (value: unknown): string | null =>
  value === undefined || value === null
    ? null
    : (readIsoTimestamp(value) ?? invalidProfilePersistence())

const httpUrl = (value: unknown): string | null => {
  if (value === null) {
    return null
  }
  const parsed = text(value, 2_048)
  try {
    return ["http:", "https:"].includes(new URL(parsed).protocol)
      ? parsed
      : invalidProfilePersistence()
  } catch {
    return invalidProfilePersistence()
  }
}

const enumValue = <T extends string>(
  value: unknown,
  values: readonly T[]
): T =>
  typeof value === "string" && values.includes(value as T)
    ? (value as T)
    : invalidProfilePersistence()

const unique = (value: string, seen: Set<string>): void => {
  if (seen.has(value)) {
    invalidProfilePersistence()
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
      : invalidProfilePersistence()
  }
  if (depth >= 8) {
    return invalidProfilePersistence()
  }
  if (Array.isArray(value)) {
    return value.length <= 500
      ? value.map((entry) => parseJson(entry, depth + 1))
      : invalidProfilePersistence()
  }
  const parsed = asUnknownRecord(value)
  if (!parsed || Object.keys(parsed).length > 200) {
    return invalidProfilePersistence()
  }
  return Object.fromEntries(
    Object.entries(parsed).map(([key, entry]) => {
      if (
        !key ||
        key.length > 255 ||
        key.includes("\u0000") ||
        FORBIDDEN_JSON_KEYS.has(key)
      ) {
        invalidProfilePersistence()
      }
      return [key, parseJson(entry, depth + 1)]
    })
  )
}

const jsonRecord = (value: unknown): JsonRecord => {
  const parsed = asUnknownRecord(parseJson(value, 0))
  if (!parsed || JSON.stringify(parsed).length > 100_000) {
    return invalidProfilePersistence()
  }
  return parsed
}

const jsonList = (value: unknown): JsonList => {
  const parsed = parseJson(value, 0)
  if (!Array.isArray(parsed) || JSON.stringify(parsed).length > 250_000) {
    return invalidProfilePersistence()
  }
  return parsed
}

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`
  }
  const parsed = asUnknownRecord(value)
  if (parsed) {
    return `{${Object.keys(parsed)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${stableJson(parsed[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value) ?? invalidProfilePersistence()
}

const matchesExpected = (actual: unknown, expected: unknown): boolean => {
  if (expected instanceof Date) {
    return actual === expected.toISOString()
  }
  if (Array.isArray(expected) || asUnknownRecord(expected)) {
    return stableJson(actual) === stableJson(parseJson(expected, 0))
  }
  return actual === expected
}

const assertExactRows = <T>(
  actual: readonly T[],
  expected: readonly Readonly<Record<string, unknown>>[]
): void => {
  if (actual.length !== expected.length) {
    invalidProfilePersistence()
  }
  const remaining = [...expected]
  actual.forEach((entry) => {
    const source = record(entry)
    const matchIndex = remaining.findIndex((candidate) =>
      Object.entries(candidate).every(([key, expectedValue]) =>
        matchesExpected(source[key], expectedValue)
      )
    )
    if (matchIndex === -1) {
      invalidProfilePersistence()
    }
    remaining.splice(matchIndex, 1)
  })
}

const artistRecord = (
  value: unknown,
  expectedId?: string
): CatalogArtistRecord => {
  const source = record(value)
  const id = identifier(source.id, "artist_")
  const slug = text(source.slug, 255)
  if ((expectedId !== undefined && id !== expectedId) || !SLUG.test(slug)) {
    return invalidProfilePersistence()
  }
  return {
    bio: nullableText(source.bio, 50_000),
    created_at: optionalTimestamp(source.created_at),
    id,
    image_url: httpUrl(source.image_url),
    location: nullableText(source.location, 500),
    metadata: jsonRecord(source.metadata),
    name: text(source.name, 500),
    slug,
    sort_name: nullableText(source.sort_name, 500),
    updated_at: optionalTimestamp(source.updated_at),
  }
}

export const readCatalogArtist = (
  value: unknown,
  expectedId?: string
): CatalogArtistRecord | null =>
  value === null || value === undefined ? null : artistRecord(value, expectedId)

export const readCatalogArtistList = (
  value: unknown,
  options: {
    expectedIds?: readonly string[]
    expectedSlug?: string
    maximumRows?: number
  } = {}
): CatalogArtistRecord[] => {
  const source = rows(value)
  if (source.length > (options.maximumRows ?? 500)) {
    return invalidProfilePersistence()
  }
  const ids = new Set<string>()
  const slugs = new Set<string>()
  const expectedIds = options.expectedIds ? new Set(options.expectedIds) : null
  return source.map((entry) => {
    const artist = artistRecord(entry)
    if (
      (options.expectedSlug !== undefined &&
        artist.slug !== options.expectedSlug) ||
      (expectedIds !== null && !expectedIds.has(artist.id)) ||
      ids.has(artist.id) ||
      slugs.has(artist.slug)
    ) {
      return invalidProfilePersistence()
    }
    ids.add(artist.id)
    slugs.add(artist.slug)
    return artist
  })
}

export const readCatalogArtistPage = (
  value: unknown,
  maximumRows: number
): { count: number; records: CatalogArtistRecord[] } => {
  let page: ReturnType<typeof readCountedRecordPage>
  try {
    page = readCountedRecordPage(value, "Catalog artist service")
  } catch {
    return invalidProfilePersistence()
  }
  if (page.records.length > maximumRows) {
    return invalidProfilePersistence()
  }
  return {
    count: page.count,
    records: readCatalogArtistList(page.records, { maximumRows }),
  }
}

export const readCatalogArtistMutation = (
  value: unknown,
  expected: { fields: Readonly<Record<string, unknown>>; id?: string }
): CatalogArtistRecord => {
  const artist = artistRecord(single(value), expected.id)
  const source = record(artist)
  Object.entries(expected.fields).forEach(([key, expectedValue]) => {
    if (!matchesExpected(source[key], expectedValue)) {
      invalidProfilePersistence()
    }
  })
  return artist
}

const referenceRecord = (
  value: unknown,
  expectedId?: string
): CatalogReferenceValueRecord => {
  const source = record(value)
  const id = identifier(source.id, "cref_")
  if (expectedId !== undefined && id !== expectedId) {
    return invalidProfilePersistence()
  }
  return {
    created_at: optionalTimestamp(source.created_at),
    description: nullableText(source.description, 10_000),
    id,
    is_active: boolean(source.is_active),
    kind: enumValue(source.kind, catalogReferenceKindValues),
    label: text(source.label, 500),
    metadata: jsonRecord(source.metadata),
    rank: integer(source.rank, 0, 1_000_000),
    updated_at: optionalTimestamp(source.updated_at),
    value: text(source.value, 500),
  }
}

export const readCatalogReferenceValue = (
  value: unknown,
  expectedId?: string
): CatalogReferenceValueRecord | null =>
  value === null || value === undefined
    ? null
    : referenceRecord(value, expectedId)

export const readCatalogReferenceValueList = (
  value: unknown,
  options: {
    expectedIds?: readonly string[]
    expectedKind?: (typeof catalogReferenceKindValues)[number]
    expectedValue?: string
    maximumRows?: number
  } = {}
): CatalogReferenceValueRecord[] => {
  const source = rows(value)
  if (source.length > (options.maximumRows ?? 500)) {
    return invalidProfilePersistence()
  }
  const ids = new Set<string>()
  const naturalKeys = new Set<string>()
  const expectedIds = options.expectedIds ? new Set(options.expectedIds) : null
  return source.map((entry) => {
    const reference = referenceRecord(entry)
    if (
      (options.expectedKind !== undefined &&
        reference.kind !== options.expectedKind) ||
      (options.expectedValue !== undefined &&
        reference.value !== options.expectedValue) ||
      (expectedIds !== null && !expectedIds.has(reference.id))
    ) {
      return invalidProfilePersistence()
    }
    unique(reference.id, ids)
    unique(`${reference.kind}:${reference.value}`, naturalKeys)
    return reference
  })
}

export const readCatalogReferenceValuePage = (
  value: unknown,
  maximumRows: number
): { count: number; records: CatalogReferenceValueRecord[] } => {
  let page: ReturnType<typeof readCountedRecordPage>
  try {
    page = readCountedRecordPage(value, "Catalog reference service")
  } catch {
    return invalidProfilePersistence()
  }
  if (page.records.length > maximumRows) {
    return invalidProfilePersistence()
  }
  return {
    count: page.count,
    records: readCatalogReferenceValueList(page.records, { maximumRows }),
  }
}

export const readCatalogReferenceValueMutation = (
  value: unknown,
  expected: { fields: Readonly<Record<string, unknown>>; id?: string }
): CatalogReferenceValueRecord => {
  const reference = referenceRecord(single(value), expected.id)
  const source = record(reference)
  Object.entries(expected.fields).forEach(([key, expectedValue]) => {
    if (!matchesExpected(source[key], expectedValue)) {
      invalidProfilePersistence()
    }
  })
  return reference
}

const productProfileRecord = (
  value: unknown,
  expectedProductId?: string
): CatalogProductProfileRecord => {
  const source = record(value)
  const productId = identifier(source.product_id, "prod_")
  if (expectedProductId !== undefined && productId !== expectedProductId) {
    return invalidProfilePersistence()
  }
  const precision = enumValue(
    source.release_date_precision,
    catalogReleaseDatePrecisionValues
  )
  const releaseDate = timestamp(source.release_date)
  const releaseYear =
    source.release_year === null
      ? null
      : integer(source.release_year, 1900, 2200)
  if (
    (precision === "day" && releaseDate === null) ||
    (precision === "year" && releaseYear === null)
  ) {
    return invalidProfilePersistence()
  }
  const description = nullableText(source.description_html, 250_000)
  if (
    description !== null &&
    sanitizeRichTextHtml(description) !== description
  ) {
    return invalidProfilePersistence()
  }
  if (
    !Array.isArray(source.search_keywords) ||
    source.search_keywords.length > 100
  ) {
    return invalidProfilePersistence()
  }
  const keywords = source.search_keywords.map((entry) => text(entry, 200))
  if (new Set(keywords).size !== keywords.length) {
    return invalidProfilePersistence()
  }
  return {
    content_schema_version: integer(source.content_schema_version, 1, 100),
    created_at: optionalTimestamp(source.created_at),
    credits: jsonRecord(source.credits),
    description_html: description,
    id: identifier(source.id, "cprof_"),
    label_id: nullableIdentifier(source.label_id, "cref_"),
    merch_details: jsonRecord(source.merch_details),
    metadata: jsonRecord(source.metadata),
    pressing_notes: jsonRecord(source.pressing_notes),
    product_id: productId,
    product_type_id: nullableIdentifier(source.product_type_id, "cref_"),
    release_date: releaseDate,
    release_date_precision: precision,
    release_title: nullableText(source.release_title, 500),
    release_year: releaseYear,
    search_keywords: keywords,
    tracklist: jsonList(source.tracklist),
    updated_at: optionalTimestamp(source.updated_at),
    version: integer(source.version, 1, Number.MAX_SAFE_INTEGER),
  }
}

export const readCatalogProductProfile = (
  value: unknown,
  expectedId?: string
): CatalogProductProfileRecord => {
  const profile = productProfileRecord(value)
  if (expectedId !== undefined && profile.id !== expectedId) {
    return invalidProfilePersistence()
  }
  return profile
}

export const readCatalogProductProfiles = (
  value: unknown,
  expectedProductId: string
): CatalogProductProfileRecord[] => {
  const source = rows(value)
  if (source.length > 1) {
    return invalidProfilePersistence()
  }
  return source.map((entry) => productProfileRecord(entry, expectedProductId))
}

export const readCatalogProductProfileList = (
  value: unknown,
  maximumRows = 250
): CatalogProductProfileRecord[] => {
  const source = rows(value)
  if (source.length > maximumRows) {
    return invalidProfilePersistence()
  }
  const ids = new Set<string>()
  return source.map((entry) => {
    const profile = productProfileRecord(entry)
    unique(profile.id, ids)
    return profile
  })
}

export const readCatalogProductProfileMutation = (
  value: unknown,
  expected: {
    fields: Readonly<Record<string, unknown>>
    id?: string
    productId: string
    version: number
  }
): CatalogProductProfileRecord => {
  const profile = productProfileRecord(single(value), expected.productId)
  if (
    (expected.id !== undefined && profile.id !== expected.id) ||
    profile.version !== expected.version
  ) {
    return invalidProfilePersistence()
  }
  const source = record(profile)
  Object.entries(expected.fields).forEach(([key, expectedValue]) => {
    if (!matchesExpected(source[key], expectedValue)) {
      invalidProfilePersistence()
    }
  })
  return profile
}

export const readCatalogProductArtists = (
  value: unknown,
  expectedProfileId: string
): CatalogProductArtistRecord[] => {
  const source = rows(value)
  if (source.length > 100) {
    return invalidProfilePersistence()
  }
  const ids = new Set<string>()
  return source.map((entry) => {
    const row = record(entry)
    const profileId = identifier(row.product_profile_id, "cprof_")
    if (profileId !== expectedProfileId) {
      return invalidProfilePersistence()
    }
    const id = identifier(row.id, "cpart_")
    unique(id, ids)
    return {
      artist_id: nullableIdentifier(row.artist_id, "artist_"),
      created_at: optionalTimestamp(row.created_at),
      display_name: text(row.display_name, 500),
      id,
      metadata: jsonRecord(row.metadata),
      product_profile_id: profileId,
      role: text(row.role, 100),
      sort_order: integer(row.sort_order, 0, 1_000_000),
      updated_at: optionalTimestamp(row.updated_at),
    }
  })
}

export const readExactCatalogProductArtists = (
  value: unknown,
  expectedProfileId: string,
  expected: readonly Readonly<Record<string, unknown>>[]
): CatalogProductArtistRecord[] => {
  const parsed = readCatalogProductArtists(value, expectedProfileId)
  assertExactRows(parsed, expected)
  return parsed
}

export const readCatalogProductReferences = (
  value: unknown,
  expectedProfileId: string
): CatalogProductReferenceRecord[] => {
  const source = rows(value)
  if (source.length > 100) {
    return invalidProfilePersistence()
  }
  const ids = new Set<string>()
  const references = new Set<string>()
  return source.map((entry) => {
    const row = record(entry)
    const profileId = identifier(row.product_profile_id, "cprof_")
    if (profileId !== expectedProfileId) {
      return invalidProfilePersistence()
    }
    const id = identifier(row.id, "cpref_")
    const referenceValueId = identifier(row.reference_value_id, "cref_")
    const kind = enumValue(row.kind, catalogReferenceKindValues)
    unique(id, ids)
    unique(`${kind}:${referenceValueId}`, references)
    return {
      created_at: optionalTimestamp(row.created_at),
      id,
      kind,
      metadata: jsonRecord(row.metadata),
      product_profile_id: profileId,
      reference_value_id: referenceValueId,
      sort_order: integer(row.sort_order, 0, 1_000_000),
      updated_at: optionalTimestamp(row.updated_at),
    }
  })
}

export const readExactCatalogProductReferences = (
  value: unknown,
  expectedProfileId: string,
  expected: readonly Readonly<Record<string, unknown>>[]
): CatalogProductReferenceRecord[] => {
  const parsed = readCatalogProductReferences(value, expectedProfileId)
  assertExactRows(parsed, expected)
  return parsed
}

const variantProfileRecord = (
  value: unknown,
  expectedVariantId?: string
): CatalogVariantProfileRecord => {
  const source = record(value)
  const variantId = identifier(source.variant_id, "variant_")
  if (variantId !== expectedVariantId) {
    return invalidProfilePersistence()
  }
  return {
    availability_status: enumValue(
      source.availability_status,
      catalogAvailabilityStatusValues
    ),
    backorder_allowed: boolean(source.backorder_allowed),
    backorder_note: nullableText(source.backorder_note, 500),
    created_at: optionalTimestamp(source.created_at),
    display_label: nullableText(source.display_label, 500),
    format_detail_id: nullableIdentifier(source.format_detail_id, "cref_"),
    format_detail_label: nullableText(source.format_detail_label, 500),
    format_id: nullableIdentifier(source.format_id, "cref_"),
    format_label: nullableText(source.format_label, 500),
    id: identifier(source.id, "cvprof_"),
    image_url: httpUrl(source.image_url),
    metadata: jsonRecord(source.metadata),
    preorder_allowed: boolean(source.preorder_allowed),
    preorder_release_date: timestamp(source.preorder_release_date),
    product_profile_id: nullableIdentifier(source.product_profile_id, "cprof_"),
    updated_at: optionalTimestamp(source.updated_at),
    variant_id: variantId,
    version: integer(source.version, 1, Number.MAX_SAFE_INTEGER),
  }
}

export const readCatalogVariantProfiles = (
  value: unknown,
  expectedVariantId: string
): CatalogVariantProfileRecord[] => {
  const source = rows(value)
  if (source.length > 1) {
    return invalidProfilePersistence()
  }
  return source.map((entry) => variantProfileRecord(entry, expectedVariantId))
}

export const readCatalogVariantProfileList = (
  value: unknown,
  expectedVariantIds: readonly string[]
): CatalogVariantProfileRecord[] => {
  const source = rows(value)
  if (source.length > expectedVariantIds.length) {
    return invalidProfilePersistence()
  }
  const expected = new Set(expectedVariantIds)
  const seenIds = new Set<string>()
  const seenVariants = new Set<string>()
  return source.map((entry) => {
    const profile = variantProfileRecord(entry)
    if (!expected.has(profile.variant_id)) {
      return invalidProfilePersistence()
    }
    unique(profile.id, seenIds)
    unique(profile.variant_id, seenVariants)
    return profile
  })
}

export const readCatalogVariantProfileMutation = (
  value: unknown,
  expected: {
    fields: Readonly<Record<string, unknown>>
    id?: string
    variantId: string
    version: number
  }
): CatalogVariantProfileRecord => {
  const profile = variantProfileRecord(single(value), expected.variantId)
  if (
    (expected.id !== undefined && profile.id !== expected.id) ||
    profile.version !== expected.version
  ) {
    return invalidProfilePersistence()
  }
  const source = record(profile)
  Object.entries(expected.fields).forEach(([key, expectedValue]) => {
    if (!matchesExpected(source[key], expectedValue)) {
      invalidProfilePersistence()
    }
  })
  return profile
}

export type ProfileOperationExpectation = {
  actorId: string | null
  aggregateId: string
  command: string
  expectedVersion: number
  id?: string
  idempotencyKey: string
  requestSha256: string
  result?: Readonly<Record<string, unknown>>
  status: "compensated" | "pending" | "succeeded"
}

export type ProfileOperationProjection = {
  actorId: string | null
  aggregateId: string
  command: string
  expectedVersion: number
  id: string
  idempotencyKey: string
  requestSha256: string
  result: UnknownRecord
  status: "compensated" | "pending" | "succeeded"
}

const operationRecord = (value: unknown): ProfileOperationProjection => {
  const source = record(value)
  const status = enumValue(source.status, [
    "compensated",
    "pending",
    "succeeded",
  ] as const)
  const completedAt = optionalTimestamp(source.completed_at)
  const result = jsonRecord(source.result)
  const requestSha256 = text(source.request_sha256, 64)
  const idempotencyKey = text(source.idempotency_key, 255)
  jsonRecord(source.metadata)
  const hasNullErrors =
    source.error_code === null && source.error_detail === null
  const hasCompensationErrors =
    status === "compensated" &&
    text(source.error_code, 255) === "workflow_compensated" &&
    text(source.error_detail, 2_000).length > 0
  if (
    !SHA256.test(requestSha256) ||
    !UUID.test(idempotencyKey) ||
    (status !== "compensated" && !hasNullErrors) ||
    (status === "compensated" && !hasCompensationErrors) ||
    (status === "pending" &&
      (completedAt !== null || Object.keys(result).length !== 0)) ||
    (status !== "pending" && completedAt === null)
  ) {
    return invalidProfilePersistence()
  }
  return {
    actorId: source.actor_id === null ? null : text(source.actor_id, 255),
    aggregateId: identifier(source.aggregate_id),
    command: text(source.command, 255),
    expectedVersion: integer(
      source.expected_version,
      0,
      Number.MAX_SAFE_INTEGER
    ),
    id: identifier(source.id, "catop_"),
    idempotencyKey,
    requestSha256,
    result,
    status,
  }
}

export const readProfileOperationList = (
  value: unknown
): ProfileOperationProjection | null => {
  const source = rows(value)
  if (source.length > 1) {
    return invalidProfilePersistence()
  }
  return source[0] ? operationRecord(source[0]) : null
}

export const readProfileOperationMutation = (
  value: unknown,
  expected: ProfileOperationExpectation
): ProfileOperationProjection => {
  const operation = operationRecord(single(value))
  if (
    operation.actorId !== expected.actorId ||
    operation.aggregateId !== expected.aggregateId ||
    operation.command !== expected.command ||
    operation.expectedVersion !== expected.expectedVersion ||
    (expected.id !== undefined && operation.id !== expected.id) ||
    operation.idempotencyKey !== expected.idempotencyKey ||
    operation.requestSha256 !== expected.requestSha256 ||
    operation.status !== expected.status ||
    (expected.result !== undefined &&
      stableJson(operation.result) !== stableJson(jsonRecord(expected.result)))
  ) {
    return invalidProfilePersistence()
  }
  return operation
}

export type ProductProfileOperationResult = {
  created: boolean
  productId: string
  profileId: string
  version: number
}

export const readProductProfileOperationResult = (
  value: unknown
): ProductProfileOperationResult => {
  const source = record(value)
  const expectedKeys = ["created", "productId", "profileId", "version"]
  if (
    Object.keys(source).length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.hasOwn(source, key))
  ) {
    return invalidProfilePersistence()
  }
  return {
    created: boolean(source.created),
    productId: identifier(source.productId, "prod_"),
    profileId: identifier(source.profileId, "cprof_"),
    version: integer(source.version, 1, Number.MAX_SAFE_INTEGER),
  }
}

export type VariantProfileOperationResult = {
  created: boolean
  profileId: string
  variantId: string
  version: number
}

export const readVariantProfileOperationResult = (
  value: unknown
): VariantProfileOperationResult => {
  const source = record(value)
  const expectedKeys = ["created", "profileId", "variantId", "version"]
  if (
    Object.keys(source).length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.hasOwn(source, key))
  ) {
    return invalidProfilePersistence()
  }
  return {
    created: boolean(source.created),
    profileId: identifier(source.profileId, "cvprof_"),
    variantId: identifier(source.variantId, "variant_"),
    version: integer(source.version, 1, Number.MAX_SAFE_INTEGER),
  }
}
