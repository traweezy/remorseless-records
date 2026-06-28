import {
  catalogAvailabilityStatuses,
  catalogReferenceKinds,
} from "./constants"

export const catalogReferenceKindValues = catalogReferenceKinds
export type CatalogReferenceKind = (typeof catalogReferenceKindValues)[number]

export const catalogAvailabilityStatusValues = catalogAvailabilityStatuses
export type CatalogAvailabilityStatus =
  (typeof catalogAvailabilityStatusValues)[number]

export type JsonRecord = Record<string, unknown>
export type JsonList = unknown[]

export type CatalogArtistRecord = {
  id: string
  name: string
  slug: string
  sort_name: string | null
  image_url: string | null
  bio: string | null
  location: string | null
  metadata: JsonRecord | null
  created_at?: Date | string | null
  updated_at?: Date | string | null
}

export type CatalogArtistDTO = {
  id: string
  name: string
  slug: string
  sortName: string | null
  imageUrl: string | null
  bio: string | null
  location: string | null
  metadata: JsonRecord
  createdAt?: string | null
  updatedAt?: string | null
}

export type CatalogReferenceValueRecord = {
  id: string
  kind: unknown
  label: string
  value: string
  description: string | null
  rank: number
  is_active: boolean
  metadata: JsonRecord | null
  created_at?: Date | string | null
  updated_at?: Date | string | null
}

export type CatalogReferenceValueDTO = {
  id: string
  kind: CatalogReferenceKind
  label: string
  value: string
  description: string | null
  rank: number
  isActive: boolean
  metadata: JsonRecord
  createdAt?: string | null
  updatedAt?: string | null
}

export type CatalogProductProfileRecord = {
  id: string
  product_id: string
  release_title: string | null
  label_id: string | null
  product_type_id: string | null
  release_date: Date | string | null
  release_year: number | null
  description_html: string | null
  search_keywords: string[] | null
  tracklist: unknown
  credits: unknown
  pressing_notes: unknown
  merch_details: unknown
  metadata: unknown
  created_at?: Date | string | null
  updated_at?: Date | string | null
}

export type CatalogProductProfileDTO = {
  id: string
  productId: string
  releaseTitle: string | null
  labelId: string | null
  productTypeId: string | null
  releaseDate: string | null
  releaseYear: number | null
  descriptionHtml: string | null
  searchKeywords: string[]
  tracklist: JsonList
  credits: JsonRecord
  pressingNotes: JsonRecord
  merchDetails: JsonRecord
  metadata: JsonRecord
  createdAt?: string | null
  updatedAt?: string | null
}

export type CatalogProductArtistRecord = {
  id: string
  product_profile_id: string
  artist_id: string | null
  display_name: string
  role: string
  sort_order: number
  metadata: JsonRecord | null
  created_at?: Date | string | null
  updated_at?: Date | string | null
}

export type CatalogProductArtistDTO = {
  id: string
  productProfileId: string
  artistId: string | null
  displayName: string
  role: string
  sortOrder: number
  metadata: JsonRecord
  createdAt?: string | null
  updatedAt?: string | null
}

export type CatalogProductReferenceRecord = {
  id: string
  product_profile_id: string
  reference_value_id: string
  kind: unknown
  sort_order: number
  metadata: JsonRecord | null
  created_at?: Date | string | null
  updated_at?: Date | string | null
}

export type CatalogProductReferenceDTO = {
  id: string
  productProfileId: string
  referenceValueId: string
  kind: CatalogReferenceKind
  sortOrder: number
  metadata: JsonRecord
  createdAt?: string | null
  updatedAt?: string | null
}

export type CatalogVariantProfileRecord = {
  id: string
  variant_id: string
  product_profile_id: string | null
  format_id: string | null
  format_detail_id: string | null
  format_label: string | null
  format_detail_label: string | null
  display_label: string | null
  availability_status: unknown
  preorder_release_date: Date | string | null
  backorder_allowed: boolean
  backorder_note: string | null
  image_url: string | null
  metadata: JsonRecord | null
  created_at?: Date | string | null
  updated_at?: Date | string | null
}

export type CatalogVariantProfileDTO = {
  id: string
  variantId: string
  productProfileId: string | null
  formatId: string | null
  formatDetailId: string | null
  formatLabel: string | null
  formatDetailLabel: string | null
  displayLabel: string | null
  availabilityStatus: CatalogAvailabilityStatus
  preorderReleaseDate: string | null
  backorderAllowed: boolean
  backorderNote: string | null
  imageUrl: string | null
  metadata: JsonRecord
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

const toRecord = (value: JsonRecord | null | undefined): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {}

const toList = (value: JsonList | null | undefined): JsonList =>
  Array.isArray(value) ? value : []

const toCatalogReferenceKind = (value: unknown): CatalogReferenceKind => {
  const match = catalogReferenceKindValues.find((kind) => kind === value)
  return match ?? "utility_tag"
}

const toCatalogAvailabilityStatus = (
  value: unknown
): CatalogAvailabilityStatus => {
  const match = catalogAvailabilityStatusValues.find((status) => status === value)
  return match ?? "available"
}

export const serializeCatalogArtist = (
  artist: CatalogArtistRecord
): CatalogArtistDTO => ({
  id: artist.id,
  name: artist.name,
  slug: artist.slug,
  sortName: artist.sort_name ?? null,
  imageUrl: artist.image_url ?? null,
  bio: artist.bio ?? null,
  location: artist.location ?? null,
  metadata: toRecord(artist.metadata),
  createdAt: toIso(artist.created_at),
  updatedAt: toIso(artist.updated_at),
})

export const serializeCatalogReferenceValue = (
  value: CatalogReferenceValueRecord
): CatalogReferenceValueDTO => ({
  id: value.id,
  kind: toCatalogReferenceKind(value.kind),
  label: value.label,
  value: value.value,
  description: value.description ?? null,
  rank: value.rank ?? 0,
  isActive: value.is_active ?? true,
  metadata: toRecord(value.metadata),
  createdAt: toIso(value.created_at),
  updatedAt: toIso(value.updated_at),
})

export const serializeCatalogProductProfile = (
  profile: CatalogProductProfileRecord
): CatalogProductProfileDTO => ({
  id: profile.id,
  productId: profile.product_id,
  releaseTitle: profile.release_title ?? null,
  labelId: profile.label_id ?? null,
  productTypeId: profile.product_type_id ?? null,
  releaseDate: toIso(profile.release_date),
  releaseYear: profile.release_year ?? null,
  descriptionHtml: profile.description_html ?? null,
  searchKeywords: profile.search_keywords ?? [],
  tracklist: toList(profile.tracklist as JsonList | null | undefined),
  credits: toRecord(profile.credits as JsonRecord | null | undefined),
  pressingNotes: toRecord(profile.pressing_notes as JsonRecord | null | undefined),
  merchDetails: toRecord(profile.merch_details as JsonRecord | null | undefined),
  metadata: toRecord(profile.metadata as JsonRecord | null | undefined),
  createdAt: toIso(profile.created_at),
  updatedAt: toIso(profile.updated_at),
})

export const serializeCatalogProductArtist = (
  artist: CatalogProductArtistRecord
): CatalogProductArtistDTO => ({
  id: artist.id,
  productProfileId: artist.product_profile_id,
  artistId: artist.artist_id ?? null,
  displayName: artist.display_name,
  role: artist.role,
  sortOrder: artist.sort_order ?? 0,
  metadata: toRecord(artist.metadata),
  createdAt: toIso(artist.created_at),
  updatedAt: toIso(artist.updated_at),
})

export const serializeCatalogProductReference = (
  reference: CatalogProductReferenceRecord
): CatalogProductReferenceDTO => ({
  id: reference.id,
  productProfileId: reference.product_profile_id,
  referenceValueId: reference.reference_value_id,
  kind: toCatalogReferenceKind(reference.kind),
  sortOrder: reference.sort_order ?? 0,
  metadata: toRecord(reference.metadata),
  createdAt: toIso(reference.created_at),
  updatedAt: toIso(reference.updated_at),
})

export const serializeCatalogVariantProfile = (
  profile: CatalogVariantProfileRecord
): CatalogVariantProfileDTO => ({
  id: profile.id,
  variantId: profile.variant_id,
  productProfileId: profile.product_profile_id ?? null,
  formatId: profile.format_id ?? null,
  formatDetailId: profile.format_detail_id ?? null,
  formatLabel: profile.format_label ?? null,
  formatDetailLabel: profile.format_detail_label ?? null,
  displayLabel: profile.display_label ?? null,
  availabilityStatus: toCatalogAvailabilityStatus(profile.availability_status),
  preorderReleaseDate: toIso(profile.preorder_release_date),
  backorderAllowed: profile.backorder_allowed ?? false,
  backorderNote: profile.backorder_note ?? null,
  imageUrl: profile.image_url ?? null,
  metadata: toRecord(profile.metadata),
  createdAt: toIso(profile.created_at),
  updatedAt: toIso(profile.updated_at),
})
