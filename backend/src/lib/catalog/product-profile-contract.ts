import { z } from "zod"

import {
  catalogReleaseDatePrecisionValues,
  catalogReferenceKindValues,
  type CatalogProductProfileRecord,
  type CatalogReferenceKind,
  type JsonList,
  type JsonRecord,
} from "../../modules/catalog/serializers"

const idSchema = z.string().trim().min(1).max(255)
const nullableIdSchema = idSchema.optional().nullable()
const nullableTextSchema = z.string().trim().max(500).optional().nullable()
const nullableDateSchema = z
  .string()
  .trim()
  .max(100)
  .refine(
    (value) => value.length === 0 || Number.isFinite(Date.parse(value)),
    "Invalid date."
  )
  .optional()
  .nullable()

export const catalogProductReferenceInputSchema = z.object({
  referenceValueId: nullableIdSchema,
  kind: z.enum(catalogReferenceKindValues).optional().nullable(),
  label: nullableTextSchema,
  value: nullableTextSchema,
  sortOrder: z.number().int().min(0).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const catalogNamedReferenceInputSchema = z.object({
  referenceValueId: nullableIdSchema,
  label: nullableTextSchema,
  value: nullableTextSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const catalogProductArtistInputSchema = z.object({
  artistId: nullableIdSchema,
  name: nullableTextSchema,
  displayName: nullableTextSchema,
  role: z.string().trim().min(1).max(100).optional(),
  sortOrder: z.number().int().min(0).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const catalogProductProfileUpsertSchema = z.object({
  idempotencyKey: z.string().uuid(),
  expectedVersion: z.number().int().min(0),
  releaseTitle: nullableTextSchema,
  labelId: nullableIdSchema,
  label: catalogNamedReferenceInputSchema.optional().nullable(),
  productTypeId: nullableIdSchema,
  productType: catalogNamedReferenceInputSchema.optional().nullable(),
  releaseDate: nullableDateSchema,
  releaseYear: z.number().int().min(1900).max(2200).optional().nullable(),
  releaseDatePrecision: z.enum(catalogReleaseDatePrecisionValues).optional(),
  descriptionHtml: z.string().max(250_000).optional().nullable(),
  searchKeywords: z.array(z.string().trim().max(200)).max(100).optional(),
  tracklist: z.array(z.unknown()).max(500).optional(),
  credits: z.record(z.string(), z.unknown()).optional(),
  pressingNotes: z.record(z.string(), z.unknown()).optional(),
  merchDetails: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  artists: z.array(catalogProductArtistInputSchema).max(100).optional(),
  references: z.array(catalogProductReferenceInputSchema).max(100).optional(),
})

export type CatalogProductProfileUpsertInput = z.infer<
  typeof catalogProductProfileUpsertSchema
>

export type CatalogProductProfileMutationInput = {
  actorId: string | null
  aggregateId: string
  command: "catalog.product-profile.upsert"
  expectedVersion: number
  idempotencyKey: string
  patch: Omit<
    CatalogProductProfileUpsertInput,
    "expectedVersion" | "idempotencyKey"
  >
  requestSha256: string
}

export type CatalogProductProfileState = {
  content_schema_version: number
  credits: JsonRecord
  description_html: string | null
  id: string
  label_id: string | null
  merch_details: JsonRecord
  metadata: JsonRecord
  pressing_notes: JsonRecord
  product_id: string
  product_type_id: string | null
  release_date: Date | string | null
  release_date_precision: CatalogProductProfileRecord["release_date_precision"]
  release_title: string | null
  release_year: number | null
  search_keywords: string[]
  tracklist: JsonList
  version: number
}

export type CatalogProductArtistState = {
  artist_id: string | null
  display_name: string
  id: string
  metadata: JsonRecord
  product_profile_id: string
  role: string
  sort_order: number
}

export type CatalogProductReferenceState = {
  id: string
  kind: CatalogReferenceKind
  metadata: JsonRecord
  product_profile_id: string
  reference_value_id: string
  sort_order: number
}

export type CatalogProductProfileSnapshot = {
  artists: CatalogProductArtistState[]
  profile: CatalogProductProfileState | null
  references: CatalogProductReferenceState[]
}

export type CatalogProductProfileMutationResult = {
  actorId: string | null
  created: boolean
  createdArtistIds: string[]
  createdReferenceValueIds: string[]
  operationId: string
  previous: CatalogProductProfileSnapshot
  productId: string
  profileId: string
  idempotencyKey: string
  replayed: boolean
  requestSha256: string
  result: JsonRecord
  version: number
}
