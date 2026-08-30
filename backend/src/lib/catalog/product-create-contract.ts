import { z } from "zod"

import { catalogProductProfileUpsertSchema } from "./product-profile-contract"
import {
  MAX_CATALOG_MEDIA_ALT_TEXT_LENGTH,
  MAX_CATALOG_PRODUCT_MEDIA_ITEMS,
} from "./product-media-constraints"
import { catalogVariantProfileUpsertSchema } from "./variant-profile-contract"

export const catalogProductCreationKinds = [
  "music_release",
  "merch",
  "fixed_bundle",
  "mystery_bundle",
] as const

const nullableTextSchema = z.string().trim().max(500).optional().nullable()
const optionTitleSchema = z.string().trim().min(1).max(100)
const optionValueSchema = z.string().trim().min(1).max(100)
const currencyCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z]{3}$/, "Use a three-letter currency code.")

const productProfileSchema = catalogProductProfileUpsertSchema.omit({
  expectedVersion: true,
  idempotencyKey: true,
})

const variantProfileSchema = catalogVariantProfileUpsertSchema.omit({
  expectedVersion: true,
  idempotencyKey: true,
  productId: true,
  productProfileId: true,
})

export const catalogProductCreateOptionSchema = z.object({
  title: optionTitleSchema,
  values: z.array(optionValueSchema).min(1).max(100),
})

export const catalogProductCreatePriceSchema = z.object({
  amount: z.number().finite().positive().max(10_000_000),
  currencyCode: currencyCodeSchema,
})

export const catalogProductCreateVariantSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/),
  title: z.string().trim().min(1).max(500),
  sku: z.string().trim().min(1).max(500),
  options: z.record(optionTitleSchema, optionValueSchema),
  prices: z.array(catalogProductCreatePriceSchema).min(1).max(20),
  stockQuantity: z.number().int().min(0).max(10_000_000).optional(),
  allowBackorder: z.boolean().optional(),
  profile: variantProfileSchema.optional(),
})

export const catalogProductCreateBundleComponentSchema = z.object({
  componentProductId: z.string().trim().min(1).max(255),
  componentVariantId: z.string().trim().min(1).max(255),
  bundleVariantKeys: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(100)
        .regex(/^[a-zA-Z0-9_-]+$/),
    )
    .min(1)
    .max(100)
    .optional(),
  title: nullableTextSchema,
  variantTitle: nullableTextSchema,
  sku: nullableTextSchema,
  quantity: z.number().int().min(1).max(10_000).default(1),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  isRequired: z.boolean().default(true),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const catalogProductCreateBundleSchema = z.object({
  displayTitle: nullableTextSchema,
  descriptionHtml: z.string().max(250_000).optional().nullable(),
  components: z
    .array(catalogProductCreateBundleComponentSchema)
    .max(100)
    .default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const catalogProductCreateMediaSchema = z.object({
  altText: z
    .string()
    .trim()
    .min(1)
    .max(MAX_CATALOG_MEDIA_ALT_TEXT_LENGTH),
  isPrimary: z.boolean(),
  mediaAssetId: z.string().trim().min(1).max(255),
  role: z.enum(["primary", "gallery"]),
  sortOrder: z
    .number()
    .int()
    .min(0)
    .max(MAX_CATALOG_PRODUCT_MEDIA_ITEMS - 1),
})

const hasNamedReference = (
  input:
    | {
        referenceValueId?: string | null | undefined
        label?: string | null | undefined
        value?: string | null | undefined
      }
    | null
    | undefined,
): boolean =>
  Boolean(
    input?.referenceValueId?.trim() ||
      input?.label?.trim() ||
      input?.value?.trim(),
  )

const hasPrimaryArtist = (
  artists: z.infer<typeof productProfileSchema>["artists"],
): boolean =>
  Boolean(
    artists?.some(
      (artist) =>
        (artist.role ?? "primary") === "primary" &&
        Boolean(
          artist.artistId?.trim() ||
            artist.displayName?.trim() ||
            artist.name?.trim(),
        ),
    ),
  )

export const catalogProductCreateSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    kind: z.enum(catalogProductCreationKinds),
    title: z.string().trim().min(1).max(500),
    handle: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "Use a lowercase, hyphen-separated handle.",
      )
      .optional(),
    description: z.string().trim().max(250_000).optional().nullable(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    media: z
      .array(catalogProductCreateMediaSchema)
      .max(MAX_CATALOG_PRODUCT_MEDIA_ITEMS)
      .default([]),
    options: z.array(catalogProductCreateOptionSchema).min(1).max(10),
    variants: z.array(catalogProductCreateVariantSchema).min(1).max(100),
    profile: productProfileSchema.default({}),
    bundle: catalogProductCreateBundleSchema.optional(),
  })
  .superRefine((input, context) => {
    const mediaAssetIds = new Set<string>()
    input.media.forEach((media, mediaIndex) => {
      const normalizedAssetId = media.mediaAssetId.toLocaleLowerCase()
      if (mediaAssetIds.has(normalizedAssetId)) {
        context.addIssue({
          code: "custom",
          message: "Each managed media asset can be used only once.",
          path: ["media", mediaIndex, "mediaAssetId"],
        })
      }
      mediaAssetIds.add(normalizedAssetId)

      if (media.sortOrder !== mediaIndex) {
        context.addIssue({
          code: "custom",
          message: "Media sort order must match the submitted gallery order.",
          path: ["media", mediaIndex, "sortOrder"],
        })
      }
      const shouldBePrimary = mediaIndex === 0
      if (
        media.isPrimary !== shouldBePrimary ||
        media.role !== (shouldBePrimary ? "primary" : "gallery")
      ) {
        context.addIssue({
          code: "custom",
          message: "The first media item must be the only primary image.",
          path: ["media", mediaIndex],
        })
      }
    })

    const optionTitles = new Set<string>()
    const optionValues = new Map<string, Set<string>>()
    input.options.forEach((option, optionIndex) => {
      const normalizedTitle = option.title.toLocaleLowerCase()
      if (optionTitles.has(normalizedTitle)) {
        context.addIssue({
          code: "custom",
          message: "Option titles must be unique.",
          path: ["options", optionIndex, "title"],
        })
      }
      optionTitles.add(normalizedTitle)

      const values = new Set<string>()
      option.values.forEach((value, valueIndex) => {
        const normalizedValue = value.toLocaleLowerCase()
        if (values.has(normalizedValue)) {
          context.addIssue({
            code: "custom",
            message: "Option values must be unique.",
            path: ["options", optionIndex, "values", valueIndex],
          })
        }
        values.add(normalizedValue)
      })
      optionValues.set(normalizedTitle, values)
    })

    const variantKeys = new Set<string>()
    const skus = new Set<string>()
    const combinations = new Set<string>()
    input.variants.forEach((variant, variantIndex) => {
      const normalizedKey = variant.key.toLocaleLowerCase()
      if (variantKeys.has(normalizedKey)) {
        context.addIssue({
          code: "custom",
          message: "Variant keys must be unique.",
          path: ["variants", variantIndex, "key"],
        })
      }
      variantKeys.add(normalizedKey)

      const normalizedSku = variant.sku?.trim().toLocaleLowerCase()
      if (normalizedSku) {
        if (skus.has(normalizedSku)) {
          context.addIssue({
            code: "custom",
            message: "Variant SKUs must be unique.",
            path: ["variants", variantIndex, "sku"],
          })
        }
        skus.add(normalizedSku)
      }

      const providedOptions = Object.entries(variant.options)
      if (providedOptions.length !== input.options.length) {
        context.addIssue({
          code: "custom",
          message: "Each variant must select every product option exactly once.",
          path: ["variants", variantIndex, "options"],
        })
      }
      const normalizedSelections = new Map<string, string>()
      providedOptions.forEach(([title, value]) => {
        const normalizedTitle = title.trim().toLocaleLowerCase()
        const normalizedValue = value.trim().toLocaleLowerCase()
        const allowedValues = optionValues.get(normalizedTitle)
        if (!allowedValues?.has(normalizedValue)) {
          context.addIssue({
            code: "custom",
            message: `Unknown option selection ${title}: ${value}.`,
            path: ["variants", variantIndex, "options", title],
          })
        }
        normalizedSelections.set(normalizedTitle, normalizedValue)
      })
      const combination = input.options
        .map((option) => {
          const title = option.title.toLocaleLowerCase()
          return `${title}:${normalizedSelections.get(title) ?? ""}`
        })
        .join("|")
      if (combinations.has(combination)) {
        context.addIssue({
          code: "custom",
          message: "Variant option combinations must be unique.",
          path: ["variants", variantIndex, "options"],
        })
      }
      combinations.add(combination)

      const currencies = new Set<string>()
      variant.prices.forEach((price, priceIndex) => {
        if (currencies.has(price.currencyCode)) {
          context.addIssue({
            code: "custom",
            message: "A variant can have only one price per currency.",
            path: ["variants", variantIndex, "prices", priceIndex],
          })
        }
        currencies.add(price.currencyCode)
      })

      if (variant.profile?.preorderAllowed) {
        if (input.kind !== "music_release") {
          context.addIssue({
            code: "custom",
            message: "This creation workflow supports preorders only for music releases.",
            path: ["variants", variantIndex, "profile", "preorderAllowed"],
          })
        }
        if (variant.allowBackorder !== true) {
          context.addIssue({
            code: "custom",
            message: "Preorders require native variant backorders to be enabled.",
            path: ["variants", variantIndex, "allowBackorder"],
          })
        }
        if (
          !variant.profile.preorderReleaseDate &&
          !input.profile.releaseDate
        ) {
          context.addIssue({
            code: "custom",
            message: "Preorders require a release date.",
            path: ["variants", variantIndex, "profile", "preorderReleaseDate"],
          })
        }
      }

      if (input.kind === "fixed_bundle") {
        if (variant.stockQuantity !== undefined) {
          context.addIssue({
            code: "custom",
            message:
              "Fixed bundle inventory is derived from components; do not set stock quantity.",
            path: ["variants", variantIndex, "stockQuantity"],
          })
        }
      } else if (variant.stockQuantity === undefined) {
        context.addIssue({
          code: "custom",
          message: "Managed products require an initial stock quantity.",
          path: ["variants", variantIndex, "stockQuantity"],
        })
      }
    })

    if (input.kind === "music_release" && !hasPrimaryArtist(input.profile.artists)) {
      context.addIssue({
        code: "custom",
        message: "Music releases require a primary artist.",
        path: ["profile", "artists"],
      })
    }

    if (
      input.kind === "merch" &&
      !input.profile.productTypeId?.trim() &&
      !hasNamedReference(input.profile.productType)
    ) {
      context.addIssue({
        code: "custom",
        message: "Merchandise requires a product type.",
        path: ["profile", "productType"],
      })
    }

    if (input.kind === "fixed_bundle") {
      if (!input.bundle?.components.length) {
        context.addIssue({
          code: "custom",
          message: "Fixed bundles require at least one component.",
          path: ["bundle", "components"],
        })
      }
    } else if (input.kind === "mystery_bundle") {
      if (input.bundle?.components.length) {
        context.addIssue({
          code: "custom",
          message: "Mystery bundles use manual inventory and cannot list components.",
          path: ["bundle", "components"],
        })
      }
    } else if (input.bundle !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Only bundle product kinds can include bundle configuration.",
        path: ["bundle"],
      })
    }

    const componentVariants = new Set<string>()
    input.bundle?.components.forEach((component, componentIndex) => {
      const normalizedVariantId = component.componentVariantId.toLowerCase()
      if (componentVariants.has(normalizedVariantId)) {
        context.addIssue({
          code: "custom",
          message:
            "Use one component row per variant and increase its quantity instead of duplicating it.",
          path: ["bundle", "components", componentIndex, "componentVariantId"],
        })
      }
      componentVariants.add(normalizedVariantId)

      component.bundleVariantKeys?.forEach((variantKey, mappingIndex) => {
        if (!variantKeys.has(variantKey.toLocaleLowerCase())) {
          context.addIssue({
            code: "custom",
            message: `Unknown bundle variant key ${variantKey}.`,
            path: [
              "bundle",
              "components",
              componentIndex,
              "bundleVariantKeys",
              mappingIndex,
            ],
          })
        }
      })
    })

    if (input.kind === "fixed_bundle") {
      input.variants.forEach((variant, variantIndex) => {
        const hasRequiredComponent = input.bundle?.components.some(
          (component) =>
            component.isRequired &&
            (!component.bundleVariantKeys ||
              component.bundleVariantKeys.some(
                (key) =>
                  key.toLocaleLowerCase() === variant.key.toLocaleLowerCase(),
              )),
        )
        if (!hasRequiredComponent) {
          context.addIssue({
            code: "custom",
            message:
              "Every fixed bundle variant needs at least one required component mapping.",
            path: ["variants", variantIndex, "key"],
          })
        }
      })
    }
  })

export type CatalogProductCreateInput = z.infer<
  typeof catalogProductCreateSchema
>

export type CatalogProductCreationKind =
  (typeof catalogProductCreationKinds)[number]
