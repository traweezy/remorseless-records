import { MedusaError } from "@medusajs/framework/utils"

import {
  hasVisibleRichText,
  sanitizeRichTextHtml,
} from "@/lib/content/rich-text"
import type {
  CatalogShelfProductRecord,
  CatalogShelfRecord,
} from "@/modules/catalog/serializers"
import {
  catalogShelfAutomationTypeValues,
  catalogShelfModeValues,
} from "@/modules/catalog/serializers"
import type { DiscographyEntryRecord } from "@/modules/discography/serializers"
import {
  discographyAvailabilityValues,
  discographySourceModeValues,
} from "@/modules/discography/serializers"
import type { NewsEntryRecord } from "@/modules/news/serializers"

import {
  readIsoTimestamp,
  readNonNegativeSafeInteger,
} from "./provider-boundary/primitives"
import {
  asUnknownRecord,
  readCountedRecordPage,
  readRecordArray,
  type UnknownRecord,
} from "./provider-boundary/records"

const STORE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,254}$/u
const STORE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const HTTP_PROTOCOLS = new Set(["http:", "https:"])

const invalidStoreModuleProjection = (): never => {
  throw new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    "The Store module projection returned invalid structured data."
  )
}

const records = (value: unknown, context: string): UnknownRecord[] => {
  try {
    return readRecordArray(value, { context })
  } catch {
    return invalidStoreModuleProjection()
  }
}

const countedRecords = (
  value: unknown,
  context: string
): { count: number; records: UnknownRecord[] } => {
  try {
    return readCountedRecordPage(value, context)
  } catch {
    return invalidStoreModuleProjection()
  }
}

const requiredIdentifier = (value: unknown, prefix: string): string =>
  typeof value === "string" &&
  value.startsWith(prefix) &&
  value === value.trim() &&
  STORE_IDENTIFIER.test(value)
    ? value
    : invalidStoreModuleProjection()

const nullableIdentifier = (value: unknown, prefix: string): string | null =>
  value === null ? null : requiredIdentifier(value, prefix)

const requiredText = (value: unknown, maximumLength: number): string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= maximumLength &&
  value === value.trim() &&
  !value.includes("\u0000")
    ? value
    : invalidStoreModuleProjection()

const nullableText = (value: unknown, maximumLength: number): string | null =>
  value === null ? null : requiredText(value, maximumLength)

const requiredBoolean = (value: unknown): boolean =>
  typeof value === "boolean" ? value : invalidStoreModuleProjection()

const boundedInteger = (
  value: unknown,
  minimum: number,
  maximum: number
): number => {
  const parsed = readNonNegativeSafeInteger(value)
  return parsed !== null && parsed >= minimum && parsed <= maximum
    ? parsed
    : invalidStoreModuleProjection()
}

const nullableTimestamp = (value: unknown): string | null =>
  value === null
    ? null
    : (readIsoTimestamp(value) ?? invalidStoreModuleProjection())

const requiredTimestamp = (value: unknown): string =>
  readIsoTimestamp(value) ?? invalidStoreModuleProjection()

const optionalTimestamp = (value: unknown): string | null =>
  value === null || value === undefined
    ? null
    : (readIsoTimestamp(value) ?? invalidStoreModuleProjection())

const timestampRangeIsValid = (
  startsAt: string | null,
  endsAt: string | null
): boolean => !startsAt || !endsAt || Date.parse(startsAt) < Date.parse(endsAt)

const stringList = (
  value: unknown,
  maximumItems: number,
  maximumLength: number
): string[] => {
  if (!Array.isArray(value) || value.length > maximumItems) {
    return invalidStoreModuleProjection()
  }
  const parsed = value.map((entry) => requiredText(entry, maximumLength))
  return new Set(parsed).size === parsed.length
    ? parsed
    : invalidStoreModuleProjection()
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
      : invalidStoreModuleProjection()
  } catch {
    return invalidStoreModuleProjection()
  }
}

const unique = (value: string, seen: Set<string>): void => {
  if (seen.has(value)) {
    invalidStoreModuleProjection()
  }
  seen.add(value)
}

const enumValue = <T extends string>(
  value: unknown,
  allowed: readonly T[]
): T =>
  typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : invalidStoreModuleProjection()

const readDiscographyEntry = (
  record: UnknownRecord
): DiscographyEntryRecord => {
  const id = requiredIdentifier(record.id, "disc_")
  const sourceMode = enumValue(record.source_mode, discographySourceModeValues)
  const productId = nullableIdentifier(record.product_id, "prod_")
  const productHandle = nullableText(record.product_handle, 255)
  if (
    (sourceMode === "catalog_product" && (!productId || !productHandle)) ||
    (sourceMode === "manual" && (productId !== null || productHandle !== null))
  ) {
    return invalidStoreModuleProjection()
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
    return invalidStoreModuleProjection()
  }
  if (record.archived_at !== null) {
    return invalidStoreModuleProjection()
  }

  return {
    album: requiredText(record.album, 500),
    archived_at: null,
    artist: requiredText(record.artist, 500),
    availability: enumValue(record.availability, discographyAvailabilityValues),
    catalog_number: nullableText(record.catalog_number, 200),
    collection_title: nullableText(record.collection_title, 500),
    cover_alt_text: nullableText(record.cover_alt_text, 500),
    cover_url: httpUrl(record.cover_url),
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
    version: boundedInteger(record.version, 1, Number.MAX_SAFE_INTEGER),
  }
}

export const readStoreDiscographyPage = (
  value: unknown
): { count: number; records: DiscographyEntryRecord[] } => {
  const page = countedRecords(value, "Store discography service")
  if (page.records.length > 200) {
    return invalidStoreModuleProjection()
  }
  const seen = new Set<string>()
  return {
    count: page.count,
    records: page.records.map((record) => {
      const entry = readDiscographyEntry(record)
      unique(entry.id, seen)
      return entry
    }),
  }
}

type StoreShelfProductProfile = {
  metadata: { source_created_at?: string }
  product_id: string
  release_date: string | null
}

const shelfMetadata = (value: unknown): Record<string, unknown> => {
  const metadata = asUnknownRecord(value)
  if (!metadata) {
    return invalidStoreModuleProjection()
  }
  const rawLookback = metadata.lookbackDays ?? metadata.lookback_days
  return rawLookback === undefined
    ? {}
    : { lookbackDays: boundedInteger(rawLookback, 1, 3_650) }
}

const profileMetadata = (
  value: unknown
): StoreShelfProductProfile["metadata"] => {
  const metadata = asUnknownRecord(value)
  if (!metadata) {
    return invalidStoreModuleProjection()
  }
  const rawCreatedAt = metadata.source_created_at ?? metadata.sourceCreatedAt
  return rawCreatedAt === undefined
    ? {}
    : {
        source_created_at:
          readIsoTimestamp(rawCreatedAt) ?? invalidStoreModuleProjection(),
      }
}

const readShelf = (record: UnknownRecord): CatalogShelfRecord => {
  const startsAt = nullableTimestamp(record.starts_at)
  const endsAt = nullableTimestamp(record.ends_at)
  if (
    !timestampRangeIsValid(startsAt, endsAt) ||
    record.archived_at !== null ||
    record.is_active !== true
  ) {
    return invalidStoreModuleProjection()
  }
  const mode = enumValue(record.mode, catalogShelfModeValues)
  const automationType = enumValue(
    record.automation_type,
    catalogShelfAutomationTypeValues
  )
  if (mode === "automatic" && automationType === "none") {
    return invalidStoreModuleProjection()
  }

  return {
    archived_at: null,
    automation_type: automationType,
    created_at: optionalTimestamp(record.created_at),
    description: nullableText(record.description, 10_000),
    ends_at: endsAt,
    handle: requiredText(record.handle, 255),
    id: requiredIdentifier(record.id, "cshelf_"),
    is_active: true,
    metadata: shelfMetadata(record.metadata),
    mode,
    product_limit:
      record.product_limit === null
        ? null
        : boundedInteger(record.product_limit, 1, 200),
    ribbon_label: nullableText(record.ribbon_label, 500),
    ribbon_priority: boundedInteger(record.ribbon_priority, 0, 1_000_000),
    show_ribbon: requiredBoolean(record.show_ribbon),
    starts_at: startsAt,
    title: requiredText(record.title, 500),
    updated_at: optionalTimestamp(record.updated_at),
    version: boundedInteger(record.version, 1, Number.MAX_SAFE_INTEGER),
  }
}

export const readStoreShelfPage = (
  value: unknown
): { count: number; records: CatalogShelfRecord[] } => {
  const page = countedRecords(value, "Store shelf service")
  if (page.records.length > 50) {
    return invalidStoreModuleProjection()
  }
  const ids = new Set<string>()
  const handles = new Set<string>()
  const parsed = page.records.map((record) => {
    const shelf = readShelf(record)
    unique(shelf.id, ids)
    unique(shelf.handle, handles)
    return shelf
  })
  return { count: page.count, records: parsed }
}

export const readStoreShelfMemberships = (
  value: unknown,
  expectedShelfIds: readonly string[]
): CatalogShelfProductRecord[] => {
  const expected = new Set(expectedShelfIds)
  const ids = new Set<string>()
  const membershipKeys = new Set<string>()
  const rawRecords = records(value, "Store shelf membership service")
  if (rawRecords.length > 2_500) {
    return invalidStoreModuleProjection()
  }
  return rawRecords.map((record) => {
    const id = requiredIdentifier(record.id, "cshelfp_")
    const shelfId = requiredIdentifier(record.shelf_id, "cshelf_")
    const productId = requiredIdentifier(record.product_id, "prod_")
    const startsAt = nullableTimestamp(record.starts_at)
    const endsAt = nullableTimestamp(record.ends_at)
    if (!expected.has(shelfId) || !timestampRangeIsValid(startsAt, endsAt)) {
      return invalidStoreModuleProjection()
    }
    unique(id, ids)
    unique(`${shelfId}:${productId}`, membershipKeys)
    return {
      created_at: optionalTimestamp(record.created_at),
      ends_at: endsAt,
      id,
      is_pinned: requiredBoolean(record.is_pinned),
      metadata: {},
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

export const readStoreShelfProductProfiles = (
  value: unknown
): StoreShelfProductProfile[] => {
  const ids = new Set<string>()
  const productIds = new Set<string>()
  const rawRecords = records(value, "Store shelf profile service")
  if (rawRecords.length > 2_500) {
    return invalidStoreModuleProjection()
  }
  return rawRecords.map((record) => {
    unique(requiredIdentifier(record.id, "cprof_"), ids)
    const productId = requiredIdentifier(record.product_id, "prod_")
    unique(productId, productIds)
    return {
      metadata: profileMetadata(record.metadata),
      product_id: productId,
      release_date: nullableTimestamp(record.release_date),
    }
  })
}

const readNewsEntry = (record: UnknownRecord, now: Date): NewsEntryRecord => {
  const publishedAt = nullableTimestamp(record.published_at)
  const archivedAt = nullableTimestamp(record.archived_at)
  const status = enumValue(record.status, ["published", "scheduled"] as const)
  if (
    !publishedAt ||
    Date.parse(publishedAt) > now.getTime() ||
    archivedAt !== null
  ) {
    return invalidStoreModuleProjection()
  }
  const slug = requiredText(record.slug, 255)
  if (!STORE_SLUG.test(slug)) {
    return invalidStoreModuleProjection()
  }
  const content = requiredText(record.content, 200_000)
  if (
    sanitizeRichTextHtml(content) !== content ||
    !hasVisibleRichText(content)
  ) {
    return invalidStoreModuleProjection()
  }
  const coverUrl = httpUrl(record.cover_url)
  const coverAltText = nullableText(record.cover_alt_text, 500)
  if ((coverUrl === null) !== (coverAltText === null)) {
    return invalidStoreModuleProjection()
  }
  return {
    archived_at: null,
    author: nullableText(record.author, 500),
    content,
    cover_alt_text: coverAltText,
    cover_url: coverUrl,
    created_at: requiredTimestamp(record.created_at),
    excerpt: nullableText(record.excerpt, 1_000),
    id: requiredIdentifier(record.id, "news_"),
    published_at: publishedAt,
    seo_description: nullableText(record.seo_description, 1_000),
    seo_title: nullableText(record.seo_title, 500),
    slug,
    status,
    tags: stringList(record.tags, 50, 100),
    title: requiredText(record.title, 300),
    updated_at: requiredTimestamp(record.updated_at),
    version: boundedInteger(record.version, 1, Number.MAX_SAFE_INTEGER),
  }
}

const readNewsRecords = (value: unknown, now: Date): NewsEntryRecord[] => {
  const ids = new Set<string>()
  const slugs = new Set<string>()
  return records(value, "Store news service").map((record) => {
    const entry = readNewsEntry(record, now)
    unique(entry.id, ids)
    unique(entry.slug, slugs)
    return entry
  })
}

export const readStoreNewsPage = (
  value: unknown,
  now: Date,
  pageWindow?: { limit: number; offset: number }
): { count: number; records: NewsEntryRecord[] } => {
  const page = countedRecords(value, "Store news service")
  if (page.records.length > 200) {
    return invalidStoreModuleProjection()
  }
  if (pageWindow) {
    const expectedRows = Math.min(
      pageWindow.limit,
      Math.max(page.count - pageWindow.offset, 0)
    )
    if (page.records.length !== expectedRows) {
      return invalidStoreModuleProjection()
    }
  }
  const parsed = readNewsRecords(page.records, now)
  return { count: page.count, records: parsed }
}

export const readStoreNewsDetail = (
  value: unknown,
  expectedSlug: string,
  now: Date
): NewsEntryRecord | null => {
  const parsed = readNewsRecords(value, now)
  if (parsed.length > 1 || (parsed[0] && parsed[0].slug !== expectedSlug)) {
    return invalidStoreModuleProjection()
  }
  return parsed[0] ?? null
}
