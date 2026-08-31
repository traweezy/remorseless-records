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
const HTTP_PROTOCOLS = new Set(["http:", "https:"])

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
    created_at: optionalTimestamp(record.created_at),
    excerpt: nullableText(record.excerpt, 1_000),
    id,
    published_at: publishedAt,
    seo_description: nullableText(record.seo_description, 1_000),
    seo_title: nullableText(record.seo_title, 500),
    slug,
    status,
    tags: stringList(record.tags, 50, 100),
    title: requiredText(record.title, 300),
    updated_at: optionalTimestamp(record.updated_at),
    version: boundedInteger(record.version, 1),
  }
}

export const readAdminNewsPage = (
  value: unknown,
  maximumRows = 100
): { count: number; records: NewsEntryRecord[] } => {
  const page = countedPage(value, maximumRows)
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
  if (
    !SHA256.test(requestSha256) ||
    (status === "pending" && completedAt !== null) ||
    (status === "succeeded" && completedAt === null) ||
    !asUnknownRecord(record.metadata) ||
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
    idempotencyKey: requiredText(record.idempotency_key, 255),
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
    createdAt: optionalTimestamp(entry.createdAt),
    excerpt: nullableText(entry.excerpt, 1_000),
    id,
    publishedAt,
    seoDescription: nullableText(entry.seoDescription, 1_000),
    seoTitle: nullableText(entry.seoTitle, 500),
    slug,
    status,
    tags: stringList(entry.tags, 50, 100),
    title: requiredText(entry.title, 300),
    updatedAt: optionalTimestamp(entry.updatedAt),
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
