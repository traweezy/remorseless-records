export const discographyAvailabilityValues = [
  "in_print",
  "out_of_print",
  "preorder",
  "digital_only",
  "unknown",
] as const

export type DiscographyAvailability =
  (typeof discographyAvailabilityValues)[number]

export type DiscographyEntryRecord = {
  id: string
  title: string
  artist: string
  album: string
  product_handle: string | null
  collection_title: string | null
  catalog_number: string | null
  release_date: Date | string | null
  release_year: number | null
  formats: string[] | null
  genres: string[] | null
  availability: DiscographyAvailability
  cover_url: string | null
  created_at?: Date | string | null
  updated_at?: Date | string | null
}

export type DiscographyEntryDTO = {
  id: string
  title: string
  artist: string
  album: string
  productHandle: string | null
  collectionTitle: string | null
  catalogNumber: string | null
  releaseDate: string | null
  releaseYear: number | null
  formats: string[]
  genres: string[]
  availability: DiscographyAvailability
  coverUrl: string | null
  createdAt?: string | null
  updatedAt?: string | null
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
  entry: DiscographyEntryRecord
): DiscographyEntryDTO => ({
  id: entry.id,
  title: entry.title,
  artist: entry.artist,
  album: entry.album,
  productHandle: entry.product_handle ?? null,
  collectionTitle: entry.collection_title ?? null,
  catalogNumber: entry.catalog_number ?? null,
  releaseDate: toIso(entry.release_date),
  releaseYear: entry.release_year ?? null,
  formats: entry.formats ?? [],
  genres: entry.genres ?? [],
  availability: entry.availability,
  coverUrl: entry.cover_url ?? null,
  createdAt: toIso(entry.created_at),
  updatedAt: toIso(entry.updated_at),
})
