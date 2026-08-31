import { z } from "zod"

const MAXIMUM_PRODUCTS = 200
const MAXIMUM_RELATIONS = 100
const MAXIMUM_VARIANTS = 250
const MAXIMUM_JSON_KEYS = 200

const identifierSchema = z.string().trim().min(1).max(255)
const nullableTextSchema = z.string().max(50_000).nullable()
const optionalNullableTextSchema = nullableTextSchema.optional()
const uniqueIdentifiers = <T extends { id: string }>(values: T[]): boolean =>
  new Set(values.map(({ id }) => id)).size === values.length
const jsonRecordSchema = z
  .record(z.string().min(1).max(255), z.unknown())
  .refine((record) => Object.keys(record).length <= MAXIMUM_JSON_KEYS)

export const referenceKindSchema = z.enum([
  "format",
  "format_detail",
  "genre",
  "label",
  "merch_type",
  "product_type",
  "utility_tag",
])

export const availabilityStatusSchema = z.enum([
  "available",
  "in_stock",
  "low_stock",
  "preorder",
  "backorder",
  "coming_soon",
  "sold_out",
  "unknown",
])

export const bundleTypeSchema = z.enum([
  "fixed",
  "mystery",
  "deal",
  "selectable",
])
export const bundleInventoryModeSchema = z.enum(["component_derived", "manual"])
export const bundleFulfillmentModeSchema = z.enum(["ship_components", "manual"])

const adminVariantSchema = z.object({
  calculated_price: z
    .object({
      calculated_amount: z.number().finite().nullable().optional(),
      currency_code: z.string().trim().min(1).max(16).nullable().optional(),
      original_amount: z.number().finite().nullable().optional(),
    })
    .nullable()
    .optional(),
  id: identifierSchema,
  inventory_quantity: z.number().finite().nullable().optional(),
  manage_inventory: z.boolean().nullable().optional(),
  options: z
    .union([
      z
        .record(z.string().min(1).max(255), z.string().max(5_000))
        .refine((record) => Object.keys(record).length <= 100),
      z
        .array(
          z.object({
            option: z
              .object({
                title: z.string().max(5_000).nullable().optional(),
              })
              .nullable()
              .optional(),
            value: z.string().max(5_000).nullable().optional(),
          })
        )
        .max(100),
    ])
    .nullable()
    .optional(),
  prices: z
    .array(
      z.object({
        amount: z.number().finite().nullable().optional(),
        currency_code: z.string().trim().min(1).max(16).nullable().optional(),
        id: identifierSchema.optional(),
      })
    )
    .max(100)
    .nullable()
    .optional(),
  sku: z.string().max(255).nullable().optional(),
  title: z.string().max(5_000).nullable().optional(),
})

export const adminProductSchema = z.object({
  created_at: z.iso.datetime().nullable().optional(),
  description: optionalNullableTextSchema,
  handle: z.string().max(255).nullable().optional(),
  id: identifierSchema,
  status: z.string().max(64).nullable().optional(),
  thumbnail: z.string().max(2_048).nullable().optional(),
  title: z.string().max(5_000).nullable().optional(),
  updated_at: z.iso.datetime().nullable().optional(),
  variants: z
    .array(adminVariantSchema)
    .max(MAXIMUM_VARIANTS)
    .refine(uniqueIdentifiers)
    .nullable()
    .optional(),
})

export const adminProductResponseSchema = z.object({
  product: adminProductSchema,
})

export const adminProductListResponseSchema = z.object({
  count: z.number().int().nonnegative().max(100_000).optional(),
  products: z
    .array(adminProductSchema)
    .max(MAXIMUM_PRODUCTS)
    .refine(uniqueIdentifiers),
})

const catalogArtistSchema = z.object({
  id: identifierSchema,
  name: z.string().trim().min(1).max(5_000),
  slug: z.string().trim().min(1).max(255),
  sortName: z.string().max(5_000).nullable(),
})

export const catalogArtistListResponseSchema = z.object({
  artists: z.array(catalogArtistSchema).max(500),
})

const catalogReferenceValueSchema = z.object({
  id: identifierSchema,
  isActive: z.boolean(),
  kind: referenceKindSchema,
  label: z.string().trim().min(1).max(5_000),
  value: z.string().trim().min(1).max(255),
})

export const catalogReferenceListResponseSchema = z.object({
  values: z.array(catalogReferenceValueSchema).max(500),
})

const catalogProductProfileSchema = z.object({
  credits: jsonRecordSchema,
  descriptionHtml: nullableTextSchema,
  id: identifierSchema,
  labelId: identifierSchema.nullable(),
  merchDetails: jsonRecordSchema,
  metadata: jsonRecordSchema,
  pressingNotes: jsonRecordSchema,
  productId: identifierSchema,
  productTypeId: identifierSchema.nullable(),
  releaseDate: z.iso.datetime().nullable(),
  releaseTitle: z.string().max(5_000).nullable(),
  releaseYear: z.number().int().min(1_000).max(9_999).nullable(),
  searchKeywords: z.array(z.string().max(255)).max(500),
  tracklist: z.array(z.unknown()).max(500),
  version: z.number().int().nonnegative(),
})

const catalogProductArtistSchema = z.object({
  artistId: identifierSchema.nullable(),
  displayName: z.string().trim().min(1).max(5_000),
  id: identifierSchema,
  role: z.string().trim().min(1).max(255),
  sortOrder: z.number().int().nonnegative(),
})

const catalogProductReferenceSchema = z.object({
  id: identifierSchema,
  kind: referenceKindSchema,
  referenceValueId: identifierSchema,
  sortOrder: z.number().int().nonnegative(),
})

export const productProfileResponseSchema = z.object({
  artists: z
    .array(catalogProductArtistSchema)
    .max(MAXIMUM_RELATIONS)
    .refine(uniqueIdentifiers),
  profile: catalogProductProfileSchema.nullable(),
  references: z
    .array(catalogProductReferenceSchema)
    .max(MAXIMUM_RELATIONS)
    .refine(uniqueIdentifiers),
})

const catalogVariantProfileSchema = z.object({
  availabilityStatus: availabilityStatusSchema,
  backorderAllowed: z.boolean(),
  backorderNote: z.string().max(5_000).nullable(),
  displayLabel: z.string().max(5_000).nullable(),
  formatDetailId: identifierSchema.nullable(),
  formatDetailLabel: z.string().max(5_000).nullable(),
  formatId: identifierSchema.nullable(),
  formatLabel: z.string().max(5_000).nullable(),
  id: identifierSchema,
  imageUrl: z.string().max(2_048).nullable(),
  preorderReleaseDate: z.iso.datetime().nullable(),
  productProfileId: identifierSchema.nullable(),
  variantId: identifierSchema,
  version: z.number().int().nonnegative(),
})

export const variantProfileResponseSchema = z.object({
  profile: catalogVariantProfileSchema.nullable(),
})

const catalogBundleProfileSchema = z.object({
  bundleType: bundleTypeSchema,
  descriptionHtml: nullableTextSchema,
  displayTitle: z.string().max(5_000).nullable(),
  fulfillmentMode: bundleFulfillmentModeSchema,
  id: identifierSchema,
  inventoryMode: bundleInventoryModeSchema,
  isActive: z.boolean(),
  productId: identifierSchema,
  productProfileId: identifierSchema.nullable(),
  version: z.number().int().nonnegative(),
})

const catalogBundleComponentSchema = z.object({
  componentInventoryItemId: identifierSchema.nullable(),
  componentProductId: identifierSchema,
  componentVariantId: identifierSchema.nullable(),
  id: identifierSchema,
  isRequired: z.boolean(),
  quantity: z.number().int().positive(),
  sku: z.string().max(255).nullable(),
  sortOrder: z.number().int().nonnegative(),
  title: z.string().max(5_000).nullable(),
  variantTitle: z.string().max(5_000).nullable(),
})

export const bundleResponseSchema = z.object({
  bundle: catalogBundleProfileSchema.nullable(),
  components: z
    .array(catalogBundleComponentSchema)
    .max(MAXIMUM_RELATIONS)
    .refine(uniqueIdentifiers),
})

export const emptyAdminResponseSchema = z.undefined()

export type AdminProduct = z.infer<typeof adminProductSchema>
export type AdminProductListResponse = z.infer<
  typeof adminProductListResponseSchema
>
export type AdminVariant = z.infer<typeof adminVariantSchema>
export type BundleResponse = z.infer<typeof bundleResponseSchema>
export type CatalogArtist = z.infer<typeof catalogArtistSchema>
export type CatalogReferenceValue = z.infer<typeof catalogReferenceValueSchema>
export type CatalogVariantProfile = z.infer<typeof catalogVariantProfileSchema>
export type ProductProfileResponse = z.infer<
  typeof productProfileResponseSchema
>
export type VariantProfileResponse = z.infer<
  typeof variantProfileResponseSchema
>
