import { z } from "zod"

import {
  catalogMediaDerivativeStatusValues,
  catalogMediaRoleValues,
  type CatalogMediaDerivativeStatus,
  type CatalogMediaRole,
  type JsonRecord,
} from "../../modules/catalog/serializers"
import {
  MAX_CATALOG_MEDIA_ALT_TEXT_LENGTH,
  MAX_CATALOG_PRODUCT_MEDIA_ITEMS,
} from "./product-media-constraints"

const nullableText = (maximum: number) =>
  z.string().trim().max(maximum).optional().nullable()
const nullableIdSchema = z.string().trim().min(1).max(255).optional().nullable()
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

export const catalogFocalPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
})

export const catalogProductMediaInputSchema = z.object({
  mediaAssetId: nullableIdSchema,
  sourceUrl: nullableHttpUrlSchema,
  sourceFileKey: nullableText(1_024),
  originalFilename: nullableText(255),
  mimeType: nullableText(255),
  byteSize: z.number().int().min(0).max(100_000_000).optional().nullable(),
  width: z.number().int().positive().max(100_000).optional().nullable(),
  height: z.number().int().positive().max(100_000).optional().nullable(),
  altText: nullableText(MAX_CATALOG_MEDIA_ALT_TEXT_LENGTH),
  caption: nullableText(10_000),
  focalPoint: catalogFocalPointSchema.optional().nullable(),
  cropIntent: nullableText(255),
  derivativeStatus: z.enum(catalogMediaDerivativeStatusValues).optional(),
  derivatives: z.record(z.string(), z.unknown()).optional(),
  assetMetadata: z.record(z.string(), z.unknown()).optional(),
  role: z.enum(catalogMediaRoleValues).optional(),
  variantId: nullableIdSchema,
  productProfileId: nullableIdSchema,
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  isPrimary: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const catalogProductMediaReplaceSchema = z.object({
  expectedVersion: z.number().int().min(0),
  idempotencyKey: z.string().uuid(),
  media: z
    .array(catalogProductMediaInputSchema)
    .max(MAX_CATALOG_PRODUCT_MEDIA_ITEMS),
})

export type CatalogProductMediaInput = z.infer<
  typeof catalogProductMediaInputSchema
>

export type CatalogProductMediaMutationInput = {
  actorId: string | null
  aggregateId: string
  command: "catalog.product-media.replace"
  expectedVersion: number
  idempotencyKey: string
  media: CatalogProductMediaInput[]
  requestSha256: string
}

export type CatalogMediaAssetState = {
  alt_text: string | null
  byte_size: number | null
  caption: string | null
  content_sha256: string | null
  crop_intent: string | null
  derivative_status: CatalogMediaDerivativeStatus
  derivatives: JsonRecord
  focal_x: number | null
  focal_y: number | null
  height: number | null
  id: string
  metadata: JsonRecord
  mime_type: string | null
  original_filename: string | null
  source_file_key: string | null
  source_url: string
  version: number
  width: number | null
}

export type CatalogProductMediaItemState = {
  id: string
  is_primary: boolean
  media_asset_id: string
  metadata: JsonRecord
  product_id: string
  product_profile_id: string | null
  role: CatalogMediaRole
  sort_order: number
  variant_id: string | null
}

export type CatalogProductMediaSnapshot = {
  assets: CatalogMediaAssetState[]
  items: CatalogProductMediaItemState[]
}

export type CatalogProductMediaMutationResult = {
  createdAssetIds: string[]
  operationId: string
  previous: CatalogProductMediaSnapshot
  productId: string
  replayed: boolean
  result: JsonRecord
  version: number
}
