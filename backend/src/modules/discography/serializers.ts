export const discographyAvailabilityValues = [
  "in_print",
  "out_of_print",
  "preorder",
  "digital_only",
  "unknown",
] as const

export type DiscographyAvailability =
  (typeof discographyAvailabilityValues)[number]

export const discographySourceModeValues = [
  "catalog_product",
  "manual",
] as const

export type DiscographySourceMode = (typeof discographySourceModeValues)[number]

export type DiscographyEntryRecord = {
  id: string
  title: string
  artist: string
  album: string
  product_id: string | null
  product_handle: string | null
  source_mode: DiscographySourceMode
  collection_title: string | null
  catalog_number: string | null
  release_date: Date | string | null
  release_year: number | null
  formats: string[] | null
  genres: string[] | null
  tags: string[] | null
  availability: DiscographyAvailability
  cover_url: string | null
  cover_alt_text: string | null
  archived_at?: Date | string | null
  version: number
  created_at?: Date | string | null
  updated_at?: Date | string | null
}

export type DiscographyLinkHealth =
  | "healthy"
  | "missing"
  | "not_applicable"
  | "unknown"
  | "unpublished"

export type DiscographyLinkedProduct = {
  handle?: string | null
  status?: string | null
}

export type DiscographySerializationOptions = {
  product?: DiscographyLinkedProduct | null
}

export type DiscographyEntryDTO = {
  id: string
  title: string
  artist: string
  album: string
  productId: string | null
  productHandle: string | null
  sourceMode: DiscographySourceMode
  collectionTitle: string | null
  catalogNumber: string | null
  releaseDate: string | null
  releaseYear: number | null
  formats: string[]
  genres: string[]
  tags: string[]
  availability: DiscographyAvailability
  coverUrl: string | null
  coverAltText: string | null
  archivedAt: string | null
  linkHealth: DiscographyLinkHealth
  lastSyncedAt: string | null
  version: number
  createdAt?: string | null
  updatedAt?: string | null
}

const resolveLinkHealth = (
  entry: DiscographyEntryRecord,
  product: DiscographyLinkedProduct | null | undefined
): DiscographyLinkHealth => {
  if (entry.source_mode === "manual") {
    return "not_applicable"
  }
  if (product === undefined) {
    return "unknown"
  }
  if (!product) {
    return "missing"
  }
  return product.status?.toLowerCase() === "published"
    ? "healthy"
    : "unpublished"
}

const toIso = (value: Date | string | null | undefined): string | null => {
  if (!value) {
    return null
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

export const serializeDiscographyEntry = (
  entry: DiscographyEntryRecord,
  options: DiscographySerializationOptions = {}
): DiscographyEntryDTO => {
  const linkHealth = resolveLinkHealth(entry, options.product)
  const productHandle =
    entry.source_mode === "catalog_product" && linkHealth === "healthy"
      ? (options.product?.handle ?? null)
      : entry.source_mode === "catalog_product" && linkHealth === "unknown"
        ? (entry.product_handle ?? null)
        : null

  return {
    id: entry.id,
    title: entry.title,
    artist: entry.artist,
    album: entry.album,
    productId: entry.product_id ?? null,
    productHandle,
    sourceMode: entry.source_mode,
    collectionTitle: entry.collection_title ?? null,
    catalogNumber: entry.catalog_number ?? null,
    releaseDate: toIso(entry.release_date),
    releaseYear: entry.release_year ?? null,
    formats: entry.formats ?? [],
    genres: entry.genres ?? [],
    tags: entry.tags ?? [],
    availability: entry.availability,
    coverUrl: entry.cover_url ?? null,
    coverAltText: entry.cover_alt_text ?? null,
    archivedAt: toIso(entry.archived_at),
    linkHealth,
    lastSyncedAt:
      entry.source_mode === "catalog_product" ? toIso(entry.updated_at) : null,
    version: entry.version,
    createdAt: toIso(entry.created_at),
    updatedAt: toIso(entry.updated_at),
  }
}
