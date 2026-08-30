import { z } from "zod"

import type {
  CatalogAvailabilityStatus,
  JsonRecord,
} from "../../modules/catalog/serializers"
import { catalogNamedReferenceInputSchema } from "./product-profile-contract"

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
const nullableHttpUrlSchema = z
  .string()
  .trim()
  .max(2_048)
  .refine((value) => {
    try {
      return ["http:", "https:"].includes(new URL(value).protocol)
    } catch {
      return false
    }
  }, "Invalid HTTP URL.")
  .optional()
  .nullable()

export const catalogVariantProfileUpsertSchema = z.object({
  idempotencyKey: z.string().uuid(),
  expectedVersion: z.number().int().min(0),
  productProfileId: nullableIdSchema,
  productId: nullableIdSchema,
  formatId: nullableIdSchema,
  format: catalogNamedReferenceInputSchema.optional().nullable(),
  formatDetailId: nullableIdSchema,
  formatDetail: catalogNamedReferenceInputSchema.optional().nullable(),
  formatLabel: nullableTextSchema,
  formatDetailLabel: nullableTextSchema,
  displayLabel: nullableTextSchema,
  preorderAllowed: z.boolean().optional(),
  preorderReleaseDate: nullableDateSchema,
  backorderAllowed: z.boolean().optional(),
  backorderNote: nullableTextSchema,
  imageUrl: nullableHttpUrlSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type CatalogVariantProfileUpsertInput = z.infer<
  typeof catalogVariantProfileUpsertSchema
>

export type CatalogVariantProfileMutationInput = {
  actorId: string | null
  aggregateId: string
  command: "catalog.variant-profile.upsert"
  expectedVersion: number
  idempotencyKey: string
  patch: Omit<
    CatalogVariantProfileUpsertInput,
    "expectedVersion" | "idempotencyKey"
  >
  requestSha256: string
}

export type CatalogVariantProfileState = {
  availability_status: CatalogAvailabilityStatus
  backorder_allowed: boolean
  backorder_note: string | null
  display_label: string | null
  format_detail_id: string | null
  format_detail_label: string | null
  format_id: string | null
  format_label: string | null
  id: string
  image_url: string | null
  metadata: JsonRecord
  preorder_allowed: boolean
  preorder_release_date: Date | string | null
  product_profile_id: string | null
  variant_id: string
  version: number
}

export type CatalogVariantProfileSnapshot = {
  profile: CatalogVariantProfileState | null
}

export type CatalogVariantProfileMutationResult = {
  created: boolean
  createdReferenceValueIds: string[]
  operationId: string
  previous: CatalogVariantProfileSnapshot
  profileId: string
  replayed: boolean
  result: JsonRecord
  variantId: string
  version: number
}
