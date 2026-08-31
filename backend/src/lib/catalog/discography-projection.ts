export const DISCOGRAPHY_REPLACE_CONFIRMATION =
  "replace-discography-from-catalog"

export type DiscographyAvailability =
  | "digital_only"
  | "in_print"
  | "out_of_print"
  | "preorder"
  | "unknown"

export type DiscographyProjectionVariant = {
  allowBackorder?: boolean | null
  availabilityStatus?: string | null
  inventoryQuantity?: number | null
  manageInventory?: boolean | null
  title?: string | null
}

export type DiscographyProjectionSource = {
  artists: Array<{ displayName: string; sortOrder: number }>
  collectionTitle?: string | null
  coverUrl?: string | null
  label?: string | null
  product: {
    handle: string
    id: string
    metadata?: Record<string, unknown> | null
    status?: string | null
    title: string
    variants: DiscographyProjectionVariant[]
  }
  profile: {
    metadata?: Record<string, unknown> | null
    productTypeValue: string
    releaseDate?: Date | string | null
    releaseTitle?: string | null
    releaseYear?: number | null
    searchKeywords?: string[] | null
  }
  references: Array<{
    kind: string
    label: string
    sortOrder: number
    value: string
  }>
}

export type DiscographyProjectionEntry = {
  album: string
  artist: string
  availability: DiscographyAvailability
  catalog_number: string | null
  collection_title: string | null
  cover_alt_text: string | null
  cover_url: string | null
  formats: string[]
  genres: string[]
  product_handle: string
  product_id: string
  release_date: Date | null
  release_year: number | null
  source_mode: "catalog_product"
  tags: string[]
  title: string
  version: number
}

export type DiscographyReplacementCommandOptions = {
  apply: boolean
  confirmation: string | null
  stateDirectory: string | null
}

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

const normalizeList = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>()
  const result: string[] = []
  values.forEach((value) => {
    const normalized = normalizeString(value)
    if (!normalized) {
      return
    }
    const key = normalized.toLocaleLowerCase("en-US")
    if (!seen.has(key)) {
      seen.add(key)
      result.push(normalized)
    }
  })
  return result
}

const normalizeReferenceValue = (value: string): string =>
  value.trim().toLowerCase().replace(/_/g, "-")

export const isMusicReleaseReference = (value: string): boolean =>
  normalizeReferenceValue(value) === "music-release"

const formatMatchers = [
  {
    label: "Vinyl",
    pattern:
      /(vinyl|\blp\b|12"|12-inch|12 inch|10"|10-inch|10 inch|7"|7-inch|7 inch|record)/i,
  },
  { label: "CD", pattern: /(compact disc|\bcd\b)/i },
  { label: "Cassette", pattern: /(cassette|tape|\bk7\b)/i },
] as const

const normalizeFormats = (values: string[]): string[] =>
  formatMatchers.flatMap(({ label, pattern }) =>
    values.some((value) => pattern.test(value)) ? [label] : []
  )

const coerceRecord = (value: unknown): Record<string, unknown> | null =>
  asUnknownRecord(value)

const extractString = (
  records: Array<Record<string, unknown> | null>,
  keys: string[]
): string | null => {
  for (const record of records) {
    if (!record) {
      continue
    }
    for (const key of keys) {
      const normalized = normalizeString(record[key])
      if (normalized) {
        return normalized
      }
    }
  }
  return null
}

const parseDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) {
    return null
  }
  const date =
    value instanceof Date ? new Date(value.getTime()) : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const resolveAvailability = (
  variants: DiscographyProjectionVariant[]
): DiscographyAvailability => {
  if (!variants.length) {
    return "unknown"
  }
  if (
    variants.some(
      (variant) =>
        normalizeString(variant.availabilityStatus)?.toLowerCase() ===
        "preorder"
    )
  ) {
    return "preorder"
  }
  const available = variants.some((variant) => {
    if (variant.allowBackorder) {
      return true
    }
    if (variant.manageInventory === false) {
      return true
    }
    return (
      typeof variant.inventoryQuantity === "number" &&
      variant.inventoryQuantity > 0
    )
  })
  return available ? "in_print" : "out_of_print"
}

const readStringArray = (
  record: Record<string, unknown> | null,
  key: string
): string[] => {
  const value = record?.[key]
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string")
  }
  return typeof value === "string" ? value.split(",") : []
}

const projectEntry = (
  source: DiscographyProjectionSource
): DiscographyProjectionEntry => {
  if (!isMusicReleaseReference(source.profile.productTypeValue)) {
    throw new Error(
      `${source.product.id} is not controlled by the music-release product type.`
    )
  }
  if (source.product.status?.toLowerCase() !== "published") {
    throw new Error(`${source.product.id} is not a published catalog product.`)
  }

  const productId = normalizeString(source.product.id)
  const handle = normalizeString(source.product.handle)
  const album =
    normalizeString(source.profile.releaseTitle) ??
    normalizeString(source.product.title)
  const artists = normalizeList(
    [...source.artists]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map(({ displayName }) => displayName)
  )
  if (!productId || !handle || !album || !artists.length) {
    throw new Error(
      `${source.product.id || "Unknown product"} is missing a product ID, handle, release title, or artist.`
    )
  }

  const artist = artists.join(" / ")
  const profileMetadata = coerceRecord(source.profile.metadata)
  const productMetadata = coerceRecord(source.product.metadata)
  const catalogImport = coerceRecord(productMetadata?.catalog_import)
  const releaseDate = parseDate(source.profile.releaseDate)
  const releaseYear =
    source.profile.releaseYear ??
    (releaseDate ? releaseDate.getUTCFullYear() : null)
  if (
    releaseYear !== null &&
    (!Number.isInteger(releaseYear) || releaseYear < 1900 || releaseYear > 2200)
  ) {
    throw new Error(`${productId} has an invalid release year.`)
  }

  const sortedReferences = [...source.references].sort(
    (left, right) => left.sortOrder - right.sortOrder
  )
  const formats = normalizeFormats([
    ...sortedReferences
      .filter(({ kind }) => kind === "format" || kind === "format_detail")
      .flatMap(({ label, value }) => [label, value]),
    ...source.product.variants.flatMap(({ title }) => title ?? []),
  ])
  const genres = normalizeList(
    sortedReferences
      .filter(({ kind }) => kind === "genre")
      .map(({ label }) => label)
  )
  const tags = normalizeList([
    ...sortedReferences
      .filter(({ kind }) => kind === "utility_tag")
      .map(({ label }) => label),
    ...readStringArray(catalogImport, "utility_tags"),
  ])
  const catalogNumber = extractString(
    [profileMetadata, catalogImport, productMetadata],
    ["catalog_number", "catalogNumber", "catalog", "cat_no"]
  )
  const coverUrl = normalizeString(source.coverUrl)

  return {
    album,
    artist,
    availability: resolveAvailability(source.product.variants),
    catalog_number: catalogNumber,
    collection_title:
      normalizeString(source.collectionTitle) ??
      normalizeString(source.label) ??
      null,
    cover_alt_text: coverUrl ? `Cover art for ${artist} — ${album}` : null,
    cover_url: coverUrl,
    formats,
    genres,
    product_handle: handle,
    product_id: productId,
    release_date: releaseDate,
    release_year: releaseYear,
    source_mode: "catalog_product",
    tags,
    title: album,
    version: 1,
  }
}

export const buildDiscographyProjection = (
  sources: DiscographyProjectionSource[]
): DiscographyProjectionEntry[] => {
  const entries = sources.map(projectEntry)
  const productIds = new Set<string>()
  const handles = new Set<string>()
  entries.forEach((entry) => {
    if (productIds.has(entry.product_id)) {
      throw new Error(
        `Discography projection contains duplicate product ${entry.product_id}.`
      )
    }
    if (handles.has(entry.product_handle)) {
      throw new Error(
        `Discography projection contains duplicate handle ${entry.product_handle}.`
      )
    }
    productIds.add(entry.product_id)
    handles.add(entry.product_handle)
  })
  return entries.sort((left, right) => {
    const yearDifference =
      (right.release_year ?? Number.NEGATIVE_INFINITY) -
      (left.release_year ?? Number.NEGATIVE_INFINITY)
    return (
      yearDifference ||
      left.artist.localeCompare(right.artist) ||
      left.album.localeCompare(right.album)
    )
  })
}

const readOption = (args: string[], name: string): string | null => {
  const inline = args.find((entry) => entry.startsWith(`${name}=`))
  if (inline) {
    return inline.slice(name.length + 1)
  }
  const index = args.indexOf(name)
  const next = index >= 0 ? args[index + 1] : null
  return next && !next.startsWith("--") ? next : null
}

export const parseDiscographyReplacementCommandOptions = (
  rawArgs: unknown[]
): DiscographyReplacementCommandOptions => {
  const args = rawArgs
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(
      (entry) =>
        entry &&
        entry !== "exec" &&
        entry !== "./exec" &&
        !entry.endsWith("/exec")
    )
  const apply = args.includes("--apply")
  const confirmation = readOption(args, "--confirm-replace")
  if (apply && confirmation !== DISCOGRAPHY_REPLACE_CONFIRMATION) {
    throw new Error(
      `Replacing discography requires --confirm-replace=${DISCOGRAPHY_REPLACE_CONFIRMATION}.`
    )
  }
  return {
    apply,
    confirmation,
    stateDirectory: readOption(args, "--state-dir"),
  }
}
import { asUnknownRecord } from "../provider-boundary/records"
