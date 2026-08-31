import { MedusaError, ProductStatus } from "@medusajs/framework/utils"

import {
  hasVisibleRichText,
  sanitizeRichTextHtml,
} from "@/lib/content/rich-text"
import {
  discographyAvailabilityValues,
  discographySourceModeValues,
  type DiscographyEntryRecord,
} from "@/modules/discography/serializers"
import {
  newsStatusValues,
  serializeNewsEntry,
  type NewsEntryDTO,
  type NewsEntryRecord,
} from "@/modules/news/serializers"

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
const SHA256 = /^[a-f0-9]{64}$/u
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const HTTP_PROTOCOLS = new Set(["http:", "https:"])

export const DISCOGRAPHY_PROJECTION_MAXIMUM_RECORDS = 25_000
export const DISCOGRAPHY_PROJECTION_PAGE_SIZE = 250

export type DiscographyProjectionPersistenceEntry = {
  album: string
  artist: string
  availability: (typeof discographyAvailabilityValues)[number]
  catalog_number: string | null
  collection_title: string | null
  cover_alt_text: string | null
  cover_url: string | null
  formats: string[]
  genres: string[]
  product_handle: string
  product_id: string
  release_date: string | null
  release_year: number | null
  source_mode: "catalog_product"
  tags: string[]
  title: string
  version: number
}

export type DiscographyProjectionRecordExpectation =
  DiscographyProjectionPersistenceEntry & {
    archived_at: string | null
    id?: string
  }

const invalidContentPersistence = (): never => {
  throw new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    "The Admin content persistence boundary returned invalid structured data."
  )
}

const requiredRecord = (value: unknown): UnknownRecord =>
  asUnknownRecord(value) ?? invalidContentPersistence()

const records = (value: unknown): UnknownRecord[] => {
  try {
    return readRecordArray(value, { context: "Admin content service" })
  } catch {
    return invalidContentPersistence()
  }
}

const requiredIdentifier = (value: unknown, prefix: string): string =>
  typeof value === "string" &&
  value.startsWith(prefix) &&
  value === value.trim() &&
  IDENTIFIER.test(value)
    ? value
    : invalidContentPersistence()

const nullableIdentifier = (value: unknown, prefix: string): string | null =>
  value === null ? null : requiredIdentifier(value, prefix)

const requiredText = (value: unknown, maximumLength: number): string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= maximumLength &&
  value === value.trim() &&
  !value.includes("\u0000")
    ? value
    : invalidContentPersistence()

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
    : invalidContentPersistence()
}

const nullableTimestamp = (value: unknown): string | null =>
  value === null
    ? null
    : (readIsoTimestamp(value) ?? invalidContentPersistence())

const requiredTimestamp = (value: unknown): string =>
  readIsoTimestamp(value) ?? invalidContentPersistence()

const optionalTimestamp = (value: unknown): string | null =>
  value === undefined || value === null
    ? null
    : (readIsoTimestamp(value) ?? invalidContentPersistence())

const enumValue = <T extends string>(
  value: unknown,
  allowed: readonly T[]
): T =>
  typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : invalidContentPersistence()

const stringList = (
  value: unknown,
  maximumItems: number,
  maximumLength: number
): string[] => {
  if (!Array.isArray(value) || value.length > maximumItems) {
    return invalidContentPersistence()
  }
  const parsed = value.map((entry) => requiredText(entry, maximumLength))
  return new Set(parsed).size === parsed.length
    ? parsed
    : invalidContentPersistence()
}

const httpUrl = (value: unknown): string | null => {
  if (value === null) {
    return null
  }
  const candidate = requiredText(value, 2_000)
  try {
    const parsed = new URL(candidate)
    return HTTP_PROTOCOLS.has(parsed.protocol)
      ? candidate
      : invalidContentPersistence()
  } catch {
    return invalidContentPersistence()
  }
}

const singleResult = (value: unknown): UnknownRecord => {
  if (Array.isArray(value)) {
    const parsed = records(value)
    return parsed.length === 1 ? parsed[0]! : invalidContentPersistence()
  }
  return requiredRecord(value)
}

const countedPage = (
  value: unknown,
  maximumRows: number
): { count: number; records: UnknownRecord[] } => {
  let page: ReturnType<typeof readCountedRecordPage>
  try {
    page = readCountedRecordPage(value, "Admin content service")
  } catch {
    return invalidContentPersistence()
  }
  return page.records.length <= maximumRows ? page : invalidContentPersistence()
}

const unique = (value: string, seen: Set<string>): void => {
  if (seen.has(value)) {
    invalidContentPersistence()
  }
  seen.add(value)
}

const exactKeys = (
  record: UnknownRecord,
  expected: readonly string[]
): void => {
  if (
    Object.keys(record).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(record, key))
  ) {
    invalidContentPersistence()
  }
}

const validateCover = (
  urlValue: unknown,
  altTextValue: unknown
): { altText: string | null; url: string | null } => {
  const url = httpUrl(urlValue)
  const altText = nullableText(altTextValue, 500)
  if ((url === null) !== (altText === null)) {
    return invalidContentPersistence()
  }
  return { altText, url }
}

export const readAdminNewsEntry = (
  value: unknown,
  expectedId?: string
): NewsEntryRecord | null => {
  if (value === null || value === undefined) {
    return null
  }
  const record = requiredRecord(value)
  const id = requiredIdentifier(record.id, "news_")
  if (expectedId !== undefined && id !== expectedId) {
    return invalidContentPersistence()
  }
  const archivedAt = nullableTimestamp(record.archived_at)
  const status = enumValue(record.status, newsStatusValues)
  const publishedAt = nullableTimestamp(record.published_at)
  if (
    (status === "draft" && publishedAt !== null) ||
    (status === "scheduled" && publishedAt === null) ||
    (status === "published" && publishedAt === null) ||
    (status === "archived" && archivedAt === null)
  ) {
    return invalidContentPersistence()
  }
  const content = requiredText(record.content, 200_000)
  if (
    sanitizeRichTextHtml(content) !== content ||
    !hasVisibleRichText(content)
  ) {
    return invalidContentPersistence()
  }
  const slug = requiredText(record.slug, 255)
  if (!SLUG.test(slug)) {
    return invalidContentPersistence()
  }
  const cover = validateCover(record.cover_url, record.cover_alt_text)
  return {
    archived_at: archivedAt,
    author: nullableText(record.author, 500),
    content,
    cover_alt_text: cover.altText,
    cover_url: cover.url,
    created_at: requiredTimestamp(record.created_at),
    excerpt: nullableText(record.excerpt, 1_000),
    id,
    published_at: publishedAt,
    seo_description: nullableText(record.seo_description, 1_000),
    seo_title: nullableText(record.seo_title, 500),
    slug,
    status,
    tags: stringList(record.tags, 50, 100),
    title: requiredText(record.title, 300),
    updated_at: requiredTimestamp(record.updated_at),
    version: boundedInteger(record.version, 1),
  }
}

export const readAdminNewsPage = (
  value: unknown,
  maximumRows = 100,
  offset = 0
): { count: number; records: NewsEntryRecord[] } => {
  const page = countedPage(value, maximumRows)
  const expectedRows = Math.min(maximumRows, Math.max(page.count - offset, 0))
  if (page.records.length !== expectedRows) {
    return invalidContentPersistence()
  }
  const ids = new Set<string>()
  const slugs = new Set<string>()
  const parsed = page.records.map((record) => {
    const entry = readAdminNewsEntry(record) ?? invalidContentPersistence()
    unique(entry.id, ids)
    unique(entry.slug, slugs)
    return entry
  })
  return { count: page.count, records: parsed }
}

export const readAdminNewsMutation = (
  value: unknown,
  expected: { id?: string; version: number }
): NewsEntryRecord => {
  const entry =
    readAdminNewsEntry(singleResult(value), expected.id) ??
    invalidContentPersistence()
  return entry.version === expected.version
    ? entry
    : invalidContentPersistence()
}

export const readNewsSlugLookup = (
  value: unknown,
  expectedSlug: string
): NewsEntryRecord | null => {
  const parsed = records(value)
  if (parsed.length > 1) {
    return invalidContentPersistence()
  }
  const entry = parsed[0] ? readAdminNewsEntry(parsed[0]) : null
  if (entry && entry.slug !== expectedSlug) {
    return invalidContentPersistence()
  }
  return entry
}

export const readAdminDiscographyEntry = (
  value: unknown,
  expectedId?: string
): DiscographyEntryRecord | null => {
  if (value === null || value === undefined) {
    return null
  }
  const record = requiredRecord(value)
  const id = requiredIdentifier(record.id, "disc_")
  if (expectedId !== undefined && id !== expectedId) {
    return invalidContentPersistence()
  }
  const sourceMode = enumValue(record.source_mode, discographySourceModeValues)
  const productId = nullableIdentifier(record.product_id, "prod_")
  const productHandle = nullableText(record.product_handle, 255)
  if (
    (sourceMode === "catalog_product" && (!productId || !productHandle)) ||
    (sourceMode === "manual" && (productId !== null || productHandle !== null))
  ) {
    return invalidContentPersistence()
  }
  const releaseDate = nullableTimestamp(record.release_date)
  const releaseYear =
    record.release_year === null
      ? null
      : boundedInteger(record.release_year, 1900, 2200)
  if (
    releaseDate &&
    releaseYear !== null &&
    new Date(releaseDate).getUTCFullYear() !== releaseYear
  ) {
    return invalidContentPersistence()
  }
  const cover = validateCover(record.cover_url, record.cover_alt_text)
  return {
    album: requiredText(record.album, 500),
    archived_at: nullableTimestamp(record.archived_at),
    artist: requiredText(record.artist, 500),
    availability: enumValue(record.availability, discographyAvailabilityValues),
    catalog_number: nullableText(record.catalog_number, 200),
    collection_title: nullableText(record.collection_title, 500),
    cover_alt_text: cover.altText,
    cover_url: cover.url,
    created_at: optionalTimestamp(record.created_at),
    formats: stringList(record.formats, 100, 200),
    genres: stringList(record.genres, 100, 200),
    id,
    product_handle: productHandle,
    product_id: productId,
    release_date: releaseDate,
    release_year: releaseYear,
    source_mode: sourceMode,
    tags: stringList(record.tags, 100, 200),
    title: requiredText(record.title, 500),
    updated_at: optionalTimestamp(record.updated_at),
    version: boundedInteger(record.version, 1),
  }
}

export const readAdminDiscographyPage = (
  value: unknown,
  maximumRows = 100
): { count: number; records: DiscographyEntryRecord[] } => {
  const page = countedPage(value, maximumRows)
  const ids = new Set<string>()
  const parsed = page.records.map((record) => {
    const entry =
      readAdminDiscographyEntry(record) ?? invalidContentPersistence()
    unique(entry.id, ids)
    return entry
  })
  return { count: page.count, records: parsed }
}

export const readAdminDiscographyMutation = (
  value: unknown,
  expected: { id?: string; version: number }
): DiscographyEntryRecord => {
  const entry =
    readAdminDiscographyEntry(singleResult(value), expected.id) ??
    invalidContentPersistence()
  return entry.version === expected.version
    ? entry
    : invalidContentPersistence()
}

const DISCOGRAPHY_PROJECTION_KEYS = [
  "album",
  "artist",
  "availability",
  "catalog_number",
  "collection_title",
  "cover_alt_text",
  "cover_url",
  "formats",
  "genres",
  "product_handle",
  "product_id",
  "release_date",
  "release_year",
  "source_mode",
  "tags",
  "title",
  "version",
] as const

const toDiscographyProjectionEntry = (
  record: DiscographyEntryRecord
): DiscographyProjectionPersistenceEntry => {
  if (
    record.source_mode !== "catalog_product" ||
    record.product_id === null ||
    record.product_handle === null ||
    record.formats === null ||
    record.genres === null ||
    record.tags === null
  ) {
    return invalidContentPersistence()
  }
  return {
    album: record.album,
    artist: record.artist,
    availability: record.availability,
    catalog_number: record.catalog_number,
    collection_title: record.collection_title,
    cover_alt_text: record.cover_alt_text,
    cover_url: record.cover_url,
    formats: record.formats,
    genres: record.genres,
    product_handle: record.product_handle,
    product_id: record.product_id,
    release_date: nullableTimestamp(record.release_date),
    release_year: record.release_year,
    source_mode: record.source_mode,
    tags: record.tags,
    title: record.title,
    version: record.version,
  }
}

export const readDiscographyProjectionInput = (
  value: unknown,
  maximumRows = DISCOGRAPHY_PROJECTION_MAXIMUM_RECORDS
): DiscographyProjectionPersistenceEntry[] => {
  if (!Array.isArray(value) || value.length > maximumRows) {
    return invalidContentPersistence()
  }
  const productIds = new Set<string>()
  const productHandles = new Set<string>()
  return value.map((candidate, index) => {
    const source = requiredRecord(candidate)
    exactKeys(source, DISCOGRAPHY_PROJECTION_KEYS)
    const entry = toDiscographyProjectionEntry(
      readAdminDiscographyEntry(
        {
          ...source,
          archived_at: null,
          id: `disc_projection_input_${index}`,
        },
        `disc_projection_input_${index}`
      ) ?? invalidContentPersistence()
    )
    if (
      entry.version !== 1 ||
      productIds.has(entry.product_id) ||
      productHandles.has(entry.product_handle)
    ) {
      return invalidContentPersistence()
    }
    productIds.add(entry.product_id)
    productHandles.add(entry.product_handle)
    return entry
  })
}

const sameDiscographyProjectionRecord = (
  actual: DiscographyEntryRecord,
  expected: DiscographyProjectionRecordExpectation
): boolean => {
  const normalized = toDiscographyProjectionEntry(actual)
  return (
    (expected.id === undefined || actual.id === expected.id) &&
    normalized.album === expected.album &&
    normalized.artist === expected.artist &&
    normalized.availability === expected.availability &&
    normalized.catalog_number === expected.catalog_number &&
    normalized.collection_title === expected.collection_title &&
    normalized.cover_alt_text === expected.cover_alt_text &&
    normalized.cover_url === expected.cover_url &&
    JSON.stringify(normalized.formats) === JSON.stringify(expected.formats) &&
    JSON.stringify(normalized.genres) === JSON.stringify(expected.genres) &&
    normalized.product_handle === expected.product_handle &&
    normalized.product_id === expected.product_id &&
    normalized.release_date === expected.release_date &&
    normalized.release_year === expected.release_year &&
    normalized.source_mode === expected.source_mode &&
    JSON.stringify(normalized.tags) === JSON.stringify(expected.tags) &&
    normalized.title === expected.title &&
    normalized.version === expected.version &&
    nullableTimestamp(actual.archived_at) === expected.archived_at
  )
}

export const readDiscographyProjectionMutationBatch = (
  value: unknown,
  expected: readonly DiscographyProjectionRecordExpectation[]
): DiscographyEntryRecord[] => {
  const mutationRecords = records(value)
  if (mutationRecords.length !== expected.length) {
    return invalidContentPersistence()
  }
  const byIdentity = new Map(
    expected.map((entry) => [entry.id ?? entry.product_id, entry])
  )
  if (byIdentity.size !== expected.length) {
    return invalidContentPersistence()
  }
  const seen = new Set<string>()
  const recordIds = new Set<string>()
  const productIds = new Set<string>()
  return mutationRecords.map((candidate) => {
    const entry =
      readAdminDiscographyEntry(candidate) ?? invalidContentPersistence()
    const key = byIdentity.has(entry.id) ? entry.id : entry.product_id
    if (
      key === null ||
      seen.has(key) ||
      recordIds.has(entry.id) ||
      (entry.product_id !== null && productIds.has(entry.product_id))
    ) {
      return invalidContentPersistence()
    }
    const expectation = byIdentity.get(key)
    if (!expectation || !sameDiscographyProjectionRecord(entry, expectation)) {
      return invalidContentPersistence()
    }
    seen.add(key)
    recordIds.add(entry.id)
    if (entry.product_id !== null) {
      productIds.add(entry.product_id)
    }
    return entry
  })
}

export const loadAllDiscographyProjectionRecords = async (
  listPage: (skip: number, take: number) => Promise<unknown>
): Promise<DiscographyEntryRecord[]> => {
  const loaded: DiscographyEntryRecord[] = []
  const ids = new Set<string>()
  const productIds = new Set<string>()
  const productHandles = new Set<string>()
  let expectedCount: number | null = null

  while (expectedCount === null || loaded.length < expectedCount) {
    const page = readAdminDiscographyPage(
      await listPage(loaded.length, DISCOGRAPHY_PROJECTION_PAGE_SIZE),
      DISCOGRAPHY_PROJECTION_PAGE_SIZE
    )
    expectedCount ??= page.count
    const expectedPageLength = Math.min(
      DISCOGRAPHY_PROJECTION_PAGE_SIZE,
      expectedCount - loaded.length
    )
    if (
      expectedCount > DISCOGRAPHY_PROJECTION_MAXIMUM_RECORDS ||
      page.count !== expectedCount ||
      expectedPageLength < 0 ||
      page.records.length !== expectedPageLength
    ) {
      return invalidContentPersistence()
    }
    for (const entry of page.records) {
      if (ids.has(entry.id)) {
        return invalidContentPersistence()
      }
      ids.add(entry.id)
      if (entry.product_id !== null) {
        if (productIds.has(entry.product_id)) {
          return invalidContentPersistence()
        }
        productIds.add(entry.product_id)
      }
      if (entry.product_handle !== null) {
        if (productHandles.has(entry.product_handle)) {
          return invalidContentPersistence()
        }
        productHandles.add(entry.product_handle)
      }
      loaded.push(entry)
    }
  }
  return loaded.length === expectedCount ? loaded : invalidContentPersistence()
}

export const assertExactDiscographyProjectionRecords = (
  recordsToValidate: readonly DiscographyEntryRecord[],
  expected: readonly DiscographyProjectionRecordExpectation[]
): void => {
  if (recordsToValidate.length !== expected.length) {
    invalidContentPersistence()
  }
  const byIdentity = new Map(
    recordsToValidate.map((entry) => [entry.id, entry] as const)
  )
  if (byIdentity.size !== recordsToValidate.length) {
    invalidContentPersistence()
  }
  const expectedIds = new Set<string>()
  for (const expectation of expected) {
    const expectedId: string = expectation.id ?? invalidContentPersistence()
    if (expectedIds.has(expectedId)) {
      invalidContentPersistence()
    }
    expectedIds.add(expectedId)
    const actual = byIdentity.get(expectedId)
    if (!actual || !sameDiscographyProjectionRecord(actual, expectation)) {
      invalidContentPersistence()
    }
  }
}

export type AdminDiscographyProductProjection = {
  handle: string | null
  id: string
  status: ProductStatus
}

export const readAdminDiscographyProducts = (
  value: unknown,
  expectedIds: readonly string[]
): AdminDiscographyProductProjection[] => {
  const expected = new Set(expectedIds)
  const seen = new Set<string>()
  const parsed = records(value)
  if (parsed.length > expected.size) {
    return invalidContentPersistence()
  }
  const statuses = Object.values(ProductStatus)
  return parsed.map((record) => {
    const id = requiredIdentifier(record.id, "prod_")
    if (!expected.has(id)) {
      return invalidContentPersistence()
    }
    unique(id, seen)
    return {
      handle: nullableText(record.handle, 255),
      id,
      status: enumValue(record.status, statuses),
    }
  })
}

export type ContentOperationExpectation = {
  actorId: string | null
  aggregateId: string
  command: string
  expectedVersion: number
  idempotencyKey: string
  kind: "discography" | "news"
  requestSha256: string
  status: "pending" | "succeeded"
}

export type ContentOperationProjection = {
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

const readOperation = (
  record: UnknownRecord,
  kind: ContentOperationExpectation["kind"]
): ContentOperationProjection => {
  const prefix = kind === "news" ? "newsop_" : "discop_"
  const actorId =
    record.actor_id === null ? null : requiredText(record.actor_id, 255)
  const requestSha256 = requiredText(record.request_sha256, 64)
  const completedAt = optionalTimestamp(record.completed_at)
  const status = enumValue(record.status, ["pending", "succeeded"] as const)
  const result = requiredRecord(record.result)
  const metadata = requiredRecord(record.metadata)
  const idempotencyKey = requiredText(record.idempotency_key, 255)
  if (
    !SHA256.test(requestSha256) ||
    !UUID.test(idempotencyKey) ||
    (status === "pending" && completedAt !== null) ||
    (status === "succeeded" && completedAt === null) ||
    Object.keys(metadata).length !== 0 ||
    (status === "pending" && Object.keys(result).length !== 0)
  ) {
    return invalidContentPersistence()
  }
  return {
    actorId,
    aggregateId: requiredText(record.aggregate_id, 500),
    command: requiredText(record.command, 255),
    expectedVersion: boundedInteger(record.expected_version, 0),
    id: requiredIdentifier(record.id, prefix),
    idempotencyKey,
    requestSha256,
    result,
    status,
  }
}

export const readContentOperationList = (
  value: unknown,
  kind: ContentOperationExpectation["kind"]
): ContentOperationProjection | null => {
  const parsed = records(value)
  if (parsed.length > 1) {
    return invalidContentPersistence()
  }
  return parsed[0] ? readOperation(parsed[0], kind) : null
}

export const readContentOperationMutation = (
  value: unknown,
  expected: ContentOperationExpectation
): ContentOperationProjection => {
  const operation = readOperation(singleResult(value), expected.kind)
  if (
    operation.actorId !== expected.actorId ||
    operation.aggregateId !== expected.aggregateId ||
    operation.command !== expected.command ||
    operation.expectedVersion !== expected.expectedVersion ||
    operation.idempotencyKey !== expected.idempotencyKey ||
    operation.requestSha256 !== expected.requestSha256 ||
    operation.status !== expected.status
  ) {
    return invalidContentPersistence()
  }
  return operation
}

export const readNewsOperationResult = (value: unknown): NewsEntryDTO => {
  const result = requiredRecord(value)
  const entry = requiredRecord(result.entry)
  exactKeys(result, ["entry", "entryId", "version"])
  exactKeys(entry, [
    "archivedAt",
    "author",
    "content",
    "coverAltText",
    "coverUrl",
    "createdAt",
    "excerpt",
    "id",
    "publishedAt",
    "seoDescription",
    "seoTitle",
    "slug",
    "status",
    "tags",
    "title",
    "updatedAt",
    "version",
  ])
  const id = requiredIdentifier(entry.id, "news_")
  const version = boundedInteger(entry.version, 1)
  if (result.entryId !== id || result.version !== version) {
    return invalidContentPersistence()
  }
  const content = requiredText(entry.content, 200_000)
  if (
    sanitizeRichTextHtml(content) !== content ||
    !hasVisibleRichText(content)
  ) {
    return invalidContentPersistence()
  }
  const archivedAt = nullableTimestamp(entry.archivedAt)
  const status = enumValue(entry.status, newsStatusValues)
  const publishedAt = nullableTimestamp(entry.publishedAt)
  const slug = requiredText(entry.slug, 255)
  if (
    (status === "archived") !== (archivedAt !== null) ||
    (status === "draft" && publishedAt !== null) ||
    ((status === "scheduled" || status === "published") &&
      publishedAt === null) ||
    !SLUG.test(slug)
  ) {
    return invalidContentPersistence()
  }
  const cover = validateCover(entry.coverUrl, entry.coverAltText)
  return {
    archivedAt,
    author: nullableText(entry.author, 500),
    content,
    coverAltText: cover.altText,
    coverUrl: cover.url,
    createdAt: requiredTimestamp(entry.createdAt),
    excerpt: nullableText(entry.excerpt, 1_000),
    id,
    publishedAt,
    seoDescription: nullableText(entry.seoDescription, 1_000),
    seoTitle: nullableText(entry.seoTitle, 500),
    slug,
    status,
    tags: stringList(entry.tags, 50, 100),
    title: requiredText(entry.title, 300),
    updatedAt: requiredTimestamp(entry.updatedAt),
    version,
  }
}

export const readExactNewsOperationResult = (
  value: unknown,
  expected: NewsEntryDTO
): NewsEntryDTO => {
  const parsed = readNewsOperationResult(value)
  const canonical = (entry: NewsEntryDTO): string =>
    JSON.stringify(
      Object.entries(entry).sort(([left], [right]) => left.localeCompare(right))
    )
  return canonical(parsed) === canonical(expected)
    ? parsed
    : invalidContentPersistence()
}

export const assertExactNewsEntry = (
  actual: NewsEntryRecord,
  expected: NewsEntryRecord
): NewsEntryRecord => {
  readExactNewsOperationResult(
    {
      entry: serializeNewsEntry(actual),
      entryId: actual.id,
      version: actual.version,
    },
    serializeNewsEntry(expected)
  )
  return actual
}

export const readDiscographyOperationResult = (
  value: unknown
): { entryId: string; version: number } => {
  const result = requiredRecord(value)
  exactKeys(result, ["entryId", "version"])
  return {
    entryId: requiredIdentifier(result.entryId, "disc_"),
    version: boundedInteger(result.version, 1),
  }
}
