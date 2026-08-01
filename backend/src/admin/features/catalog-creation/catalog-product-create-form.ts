import { z } from "zod"

import {
  MANAGED_IMAGE_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  type ManagedImageMimeType,
} from "../../../lib/uploads/constraints"
import {
  MAX_CATALOG_MEDIA_ALT_TEXT_LENGTH,
  MAX_CATALOG_PRODUCT_MEDIA_ITEMS,
} from "../../../lib/catalog/product-media-constraints"

export const catalogCreationKinds = [
  "music_release",
  "merch",
  "fixed_bundle",
  "mystery_bundle",
] as const

export type CatalogCreationKind = (typeof catalogCreationKinds)[number]

export const catalogCreationReleaseDatePrecisions = [
  "unknown",
  "year",
  "month",
  "day",
] as const

export type CatalogCreationReleaseDatePrecision =
  (typeof catalogCreationReleaseDatePrecisions)[number]

export type CatalogCreationArtistChoice = {
  id: string
  name: string
}

export type CatalogCreationReferenceChoice = {
  id: string
  isActive: boolean
  kind:
    | "format"
    | "format_detail"
    | "genre"
    | "label"
    | "merch_type"
    | "product_type"
    | "utility_tag"
  label: string
}

export type CatalogCreationVocabulary = {
  artists: CatalogCreationArtistChoice[]
  references: CatalogCreationReferenceChoice[]
}

export const catalogCreationAvailabilityPolicies = [
  "inventory_only",
  "backorder",
  "preorder",
] as const

export type CatalogCreationAvailabilityPolicy =
  (typeof catalogCreationAvailabilityPolicies)[number]

export type CatalogCreationOffering = {
  availabilityPolicy: CatalogCreationAvailabilityPolicy
  color: string
  format: string
  formatDetail: string
  id: string
  priceUsd: string
  size: string
  sku: string
  stockQuantity: string
  title: string
}

export type CatalogCreationBundleComponent = {
  id: string
  offeringIds: string[]
  productId: string
  quantity: string
  variantId: string
}

export type CatalogCreationMedia = {
  altText: string
  byteSize: number
  id: string
  mediaAssetId: string
  mimeType: ManagedImageMimeType
  originalFilename: string
  sourceFileKey: string
  sourceUrl: string
}

export type CatalogCreationFormValues = {
  artistId: string
  artistName: string
  catalogNumber: string
  credits: string
  description: string
  genreId: string
  genre: string
  handle: string
  kind: CatalogCreationKind
  labelId: string
  label: string
  material: string
  merchandiseCare: string
  merchandiseFit: string
  merchandiseType: string
  merchandiseTypeId: string
  media: CatalogCreationMedia[]
  mysteryDisclaimer: string
  mysteryPromise: string
  offerings: CatalogCreationOffering[]
  productTypeId: string
  productType: string
  releaseDate: string
  releaseDatePrecision: CatalogCreationReleaseDatePrecision
  sizeGuide: string
  title: string
  tracklist: string
  bundleComponents: CatalogCreationBundleComponent[]
}

export type CatalogCreationProductChoice = {
  id: string
  title: string
  variants: Array<{
    id: string
    sku: string | null
    title: string
  }>
}

export type CatalogProductCreateRequest = {
  bundle?: {
    components: Array<{
      bundleVariantKeys: string[]
      componentProductId: string
      componentVariantId: string
      quantity: number
      sku?: string
      sortOrder: number
      title: string
      variantTitle: string
    }>
    descriptionHtml?: string | null
    displayTitle: string
  }
  description?: string | null
  handle?: string
  idempotencyKey: string
  kind: CatalogCreationKind
  media: Array<{
    altText: string
    isPrimary: boolean
    mediaAssetId: string
    role: "gallery" | "primary"
    sortOrder: number
  }>
  options: Array<{ title: string; values: string[] }>
  profile: Record<string, unknown>
  title: string
  variants: Array<{
    allowBackorder: boolean
    key: string
    options: Record<string, string>
    prices: Array<{ amount: number; currencyCode: "usd" }>
    profile: Record<string, unknown>
    sku?: string
    stockQuantity?: number
    title: string
  }>
}

export const catalogCreationKindLabels: Record<CatalogCreationKind, string> = {
  music_release: "Music release",
  merch: "Merchandise",
  fixed_bundle: "Fixed bundle",
  mystery_bundle: "Mystery box",
}

export const catalogCreationKindDescriptions: Record<
  CatalogCreationKind,
  string
> = {
  music_release: "CD, vinyl, cassette, or digital formats from an artist.",
  merch: "Clothing and other physical merchandise with size or color options.",
  fixed_bundle: "A known set of products whose stock comes from its contents.",
  mystery_bundle: "A surprise assortment with its own manually counted stock.",
}

export type CatalogCreationMerchandiseTemplate = {
  description: string
  id: "one_size" | "apparel_standard" | "apparel_extended"
  label: string
  sizes: readonly string[]
}

export const catalogCreationMerchandiseTemplates = [
  {
    description: "A single variant for buttons, patches, bags, books, and other unsized items.",
    id: "one_size",
    label: "One size",
    sizes: ["One size"],
  },
  {
    description: "Five common adult apparel sizes from S through 2XL.",
    id: "apparel_standard",
    label: "Apparel S–2XL",
    sizes: ["S", "M", "L", "XL", "2XL"],
  },
  {
    description: "Seven adult apparel sizes from XS through 3XL.",
    id: "apparel_extended",
    label: "Apparel XS–3XL",
    sizes: ["XS", "S", "M", "L", "XL", "2XL", "3XL"],
  },
] as const satisfies readonly CatalogCreationMerchandiseTemplate[]

export type CatalogCreationMerchandiseTemplateId =
  (typeof catalogCreationMerchandiseTemplates)[number]["id"]

const key = (): string => crypto.randomUUID()

const defaultOffering = (kind: CatalogCreationKind): CatalogCreationOffering => {
  if (kind === "merch") {
    return {
      availabilityPolicy: "inventory_only",
      color: "",
      format: "Merch",
      formatDetail: "",
      id: key(),
      priceUsd: "0.00",
      size: "One size",
      sku: "",
      stockQuantity: "0",
      title: "One size",
    }
  }
  const title = kind === "mystery_bundle" ? "Mystery box" : kind === "fixed_bundle" ? "Bundle" : "Vinyl"
  return {
    availabilityPolicy: "inventory_only",
    color: "",
    format: title,
    formatDetail: "",
    id: key(),
    priceUsd: "0.00",
    size: "",
    sku: "",
    stockQuantity: "0",
    title,
  }
}

export const createCatalogCreationMerchandiseOfferings = (
  templateId: CatalogCreationMerchandiseTemplateId,
  currentOfferings: CatalogCreationOffering[],
  createId: () => string = key,
): CatalogCreationOffering[] => {
  const template = catalogCreationMerchandiseTemplates.find(
    (candidate) => candidate.id === templateId,
  )
  if (!template) {
    throw new Error(`Unknown merchandise offering template: ${templateId}`)
  }
  const seed = currentOfferings[0] ?? defaultOffering("merch")
  return template.sizes.map((size) => ({
    availabilityPolicy: "inventory_only",
    color: "",
    format: "Merch",
    formatDetail: "",
    id: createId(),
    priceUsd: seed.priceUsd,
    size,
    sku: "",
    stockQuantity: "0",
    title: size,
  }))
}

const productTypeForKind = (kind: CatalogCreationKind): string => {
  if (kind === "merch") {
    return "Merchandise"
  }
  if (kind === "fixed_bundle" || kind === "mystery_bundle") {
    return "Bundle"
  }
  return "Music Release"
}

export const createCatalogCreationDefaults = (
  kind: CatalogCreationKind = "music_release",
): CatalogCreationFormValues => ({
  artistId: "",
  artistName: "",
  bundleComponents: [],
  catalogNumber: "",
  credits: "",
  description: "",
  genreId: "",
  genre: "",
  handle: "",
  kind,
  labelId: "",
  label: "Remorseless Records",
  material: "",
  media: [],
  merchandiseCare: "",
  merchandiseFit: "",
  merchandiseType: "",
  merchandiseTypeId: "",
  mysteryDisclaimer: "",
  mysteryPromise: "",
  offerings: [defaultOffering(kind)],
  productTypeId: "",
  productType: productTypeForKind(kind),
  releaseDate: "",
  releaseDatePrecision: "unknown",
  sizeGuide: "",
  title: "",
  tracklist: "",
})

export const applyCatalogCreationKind = (
  values: CatalogCreationFormValues,
  kind: CatalogCreationKind,
): CatalogCreationFormValues => ({
  ...values,
  bundleComponents: kind === "fixed_bundle" ? values.bundleComponents : [],
  kind,
  offerings: [defaultOffering(kind)],
  productTypeId: "",
  productType: productTypeForKind(kind),
})

const nonnegativeIntegerString = z
  .string()
  .trim()
  .regex(/^\d+$/, "Enter a whole number of zero or more.")
const moneyString = z
  .string()
  .trim()
  .refine(
    (value) => /^\d+(?:\.\d{1,2})?$/.test(value) && Number(value) >= 0,
    "Enter a valid non-negative amount with no more than two decimals.",
  )

const releaseDatePatterns: Record<
  Exclude<CatalogCreationReleaseDatePrecision, "unknown">,
  RegExp
> = {
  day: /^\d{4}-\d{2}-\d{2}$/,
  month: /^\d{4}-\d{2}$/,
  year: /^\d{4}$/,
}

export const normalizeCatalogCreationReleaseDate = (
  value: string,
  precision: CatalogCreationReleaseDatePrecision,
): string | null => {
  const trimmed = value.trim()
  if (!trimmed || precision === "unknown") {
    return null
  }
  if (!releaseDatePatterns[precision].test(trimmed)) {
    return null
  }
  if (precision === "year") {
    return `${trimmed}-01-01`
  }
  if (precision === "month") {
    return `${trimmed}-01`
  }
  return trimmed
}

const isValidReleaseDate = (
  value: string,
  precision: CatalogCreationReleaseDatePrecision,
): boolean => {
  const normalized = normalizeCatalogCreationReleaseDate(value, precision)
  if (!normalized) {
    return false
  }
  const [year, month, day] = normalized.split("-").map(Number)
  if (!year || year < 1900 || year > 2200 || !month || !day) {
    return false
  }
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  )
}

const offeringSchema = z.object({
  availabilityPolicy: z.enum(catalogCreationAvailabilityPolicies),
  color: z.string().trim().max(100),
  format: z.string().trim().max(100),
  formatDetail: z.string().trim().max(100),
  id: z.string().min(1),
  priceUsd: moneyString,
  size: z.string().trim().max(100),
  sku: z.string().trim().max(500),
  stockQuantity: nonnegativeIntegerString,
  title: z.string().trim().min(1, "Give this offering a customer-facing name.").max(500),
})

const componentSchema = z.object({
  id: z.string().min(1),
  offeringIds: z.array(z.string().min(1)).min(1, "Choose at least one bundle offering."),
  productId: z.string().trim().min(1, "Choose an included product."),
  quantity: z
    .string()
    .trim()
    .regex(/^[1-9]\d*$/, "Enter a quantity of one or more."),
  variantId: z.string().trim().min(1, "Choose an included product format."),
})

const mediaSchema = z.object({
  altText: z
    .string()
    .trim()
    .min(1, "Describe every image for customers who cannot see it.")
    .max(MAX_CATALOG_MEDIA_ALT_TEXT_LENGTH),
  byteSize: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  id: z.string().min(1).max(100),
  mediaAssetId: z.string().trim().min(1).max(255),
  mimeType: z.enum(MANAGED_IMAGE_MIME_TYPES),
  originalFilename: z.string().trim().min(1).max(255),
  sourceFileKey: z.string().trim().min(1).max(1_024),
  sourceUrl: z.string().trim().url().max(2_048),
})

export const catalogCreationFormSchema = z
  .object({
    artistId: z.string().trim().max(255),
    artistName: z.string().trim().max(500),
    bundleComponents: z.array(componentSchema).max(100),
    catalogNumber: z.string().trim().max(200),
    credits: z.string().trim().max(50_000),
    description: z.string().trim().max(250_000),
    genreId: z.string().trim().max(255),
    genre: z.string().trim().max(200),
    handle: z
      .string()
      .trim()
      .max(255)
      .refine(
        (value) => !value || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value),
        "Use lowercase words separated by hyphens.",
      ),
    kind: z.enum(catalogCreationKinds),
    labelId: z.string().trim().max(255),
    label: z.string().trim().max(500),
    material: z.string().trim().max(5_000),
    merchandiseCare: z.string().trim().max(5_000),
    merchandiseFit: z.string().trim().max(5_000),
    merchandiseType: z.string().trim().max(500),
    merchandiseTypeId: z.string().trim().max(255),
    media: z.array(mediaSchema).max(MAX_CATALOG_PRODUCT_MEDIA_ITEMS),
    mysteryDisclaimer: z.string().trim().max(10_000),
    mysteryPromise: z.string().trim().max(10_000),
    offerings: z.array(offeringSchema).min(1).max(100),
    productTypeId: z.string().trim().max(255),
    productType: z.string().trim().min(1, "Choose a product type.").max(500),
    releaseDate: z.string().trim().max(10),
    releaseDatePrecision: z.enum(catalogCreationReleaseDatePrecisions),
    sizeGuide: z.string().trim().max(10_000),
    title: z.string().trim().min(1, "Enter a product name.").max(500),
    tracklist: z.string().trim().max(50_000),
  })
  .superRefine((values, context) => {
    if (values.kind === "music_release" && !values.artistName) {
      context.addIssue({
        code: "custom",
        message: "Choose or enter the primary artist.",
        path: ["artistName"],
      })
    }
    if (values.kind === "merch" && !values.merchandiseType) {
      context.addIssue({
        code: "custom",
        message: "Choose or enter a merchandise type.",
        path: ["merchandiseType"],
      })
    }
    if (
      values.kind === "music_release" &&
      values.releaseDatePrecision !== "unknown" &&
      !isValidReleaseDate(values.releaseDate, values.releaseDatePrecision)
    ) {
      context.addIssue({
        code: "custom",
        message: `Enter a valid release ${values.releaseDatePrecision}.`,
        path: ["releaseDate"],
      })
    }
    const combinations = new Set<string>()
    values.offerings.forEach((offering, index) => {
      if (
        offering.availabilityPolicy === "preorder" &&
        values.kind !== "music_release"
      ) {
        context.addIssue({
          code: "custom",
          message: "Preorders are available only for music releases in this workflow.",
          path: ["offerings", index, "availabilityPolicy"],
        })
      }
      if (offering.availabilityPolicy === "preorder") {
        const releaseDate = normalizeCatalogCreationReleaseDate(
          values.releaseDate,
          values.releaseDatePrecision,
        )
        if (!releaseDate || Date.parse(releaseDate) <= Date.now()) {
          context.addIssue({
            code: "custom",
            message: "Choose a future release date before accepting preorders.",
            path: ["offerings", index, "availabilityPolicy"],
          })
        }
      }
      if (values.kind === "merch" && !offering.size) {
        context.addIssue({
          code: "custom",
          message: "Enter a size or style.",
          path: ["offerings", index, "size"],
        })
      }
      if (values.kind !== "merch" && !offering.format) {
        context.addIssue({
          code: "custom",
          message: "Choose a format.",
          path: ["offerings", index, "format"],
        })
      }
      const combination =
        values.kind === "merch"
          ? `${offering.size.toLowerCase()}|${offering.color.toLowerCase()}`
          : `${offering.format.toLowerCase()}|${offering.formatDetail.toLowerCase()}`
      if (combinations.has(combination)) {
        context.addIssue({
          code: "custom",
          message: "Each offering combination must be unique.",
          path: ["offerings", index],
        })
      }
      combinations.add(combination)
    })
    if (values.kind === "merch") {
      const usesColor = values.offerings.some((offering) => offering.color)
      if (usesColor) {
        values.offerings.forEach((offering, index) => {
          if (!offering.color) {
            context.addIssue({
              code: "custom",
              message: "Enter a color for every offering or leave all colors blank.",
              path: ["offerings", index, "color"],
            })
          }
        })
      }
    }
    if (values.kind === "fixed_bundle") {
      if (!values.bundleComponents.length) {
        context.addIssue({
          code: "custom",
          message: "Add at least one included product.",
          path: ["bundleComponents"],
        })
      }
      values.offerings.forEach((offering, index) => {
        if (
          !values.bundleComponents.some((component) =>
            component.offeringIds.includes(offering.id),
          )
        ) {
          context.addIssue({
            code: "custom",
            message: "Map at least one included product to this bundle offering.",
            path: ["offerings", index],
          })
        }
      })
    }
  })

const slugify = (value: string, fallback: string): string => {
  const slug = value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || fallback
}

export const resolveCatalogCreationHandle = (
  handle: string,
  title: string,
): string => handle.trim() || slugify(title, "draft-product")

const nullable = (value: string): string | null => value.trim() || null

const offeringKeyMap = (
  offerings: CatalogCreationOffering[],
): Map<string, string> => {
  const used = new Set<string>()
  return new Map(
    offerings.map((offering, index) => {
      const base = slugify(offering.title, `offering-${index + 1}`)
      let candidate = base
      let suffix = 2
      while (used.has(candidate)) {
        candidate = `${base}-${suffix}`
        suffix += 1
      }
      used.add(candidate)
      return [offering.id, candidate]
    }),
  )
}

const findProductChoice = (
  choices: CatalogCreationProductChoice[],
  productId: string,
): CatalogCreationProductChoice | undefined =>
  choices.find((choice) => choice.id === productId)

const normalizeVocabularyLabel = (value: string): string =>
  value.trim().toLowerCase()

const resolveArtistId = (
  values: CatalogCreationFormValues,
  vocabulary: CatalogCreationVocabulary,
): string | undefined => {
  const explicitId = values.artistId.trim()
  const normalizedName = normalizeVocabularyLabel(values.artistName)
  if (
    explicitId &&
    (!vocabulary.artists.length ||
      vocabulary.artists.some(
        (artist) =>
          artist.id === explicitId &&
          normalizeVocabularyLabel(artist.name) === normalizedName,
      ))
  ) {
    return explicitId
  }
  return vocabulary.artists.find(
    (artist) =>
      normalizeVocabularyLabel(artist.name) === normalizedName,
  )?.id
}

const resolveReferenceId = (
  explicitId: string,
  kind: CatalogCreationReferenceChoice["kind"],
  label: string,
  vocabulary: CatalogCreationVocabulary,
): string | undefined => {
  const selectedId = explicitId.trim()
  const normalizedLabel = normalizeVocabularyLabel(label)
  if (
    selectedId &&
    (!vocabulary.references.length ||
      vocabulary.references.some(
        (reference) =>
          reference.id === selectedId &&
          reference.isActive &&
          reference.kind === kind &&
          normalizeVocabularyLabel(reference.label) === normalizedLabel,
      ))
  ) {
    return selectedId
  }
  return vocabulary.references.find(
    (reference) =>
      reference.isActive &&
      reference.kind === kind &&
      normalizeVocabularyLabel(reference.label) === normalizedLabel,
  )?.id
}

const emptyVocabulary: CatalogCreationVocabulary = {
  artists: [],
  references: [],
}

export const buildCatalogProductCreateRequest = (
  rawValues: CatalogCreationFormValues,
  idempotencyKey: string,
  choices: CatalogCreationProductChoice[],
  vocabulary: CatalogCreationVocabulary = emptyVocabulary,
): CatalogProductCreateRequest => {
  const values = catalogCreationFormSchema.parse(rawValues)
  const keys = offeringKeyMap(values.offerings)
  const usesColor =
    values.kind === "merch" &&
    values.offerings.some((offering) => offering.color)
  const options =
    values.kind === "merch"
      ? [
          {
            title: "Size",
            values: Array.from(
              new Set(values.offerings.map((offering) => offering.size)),
            ),
          },
          ...(usesColor
            ? [
                {
                  title: "Color",
                  values: Array.from(
                    new Set(values.offerings.map((offering) => offering.color)),
                  ),
                },
              ]
            : []),
        ]
      : [
          {
            title: "Format",
            values: Array.from(
              new Set(values.offerings.map((offering) => offering.title)),
            ),
          },
        ]
  const releaseDate =
    values.kind === "music_release"
      ? normalizeCatalogCreationReleaseDate(
          values.releaseDate,
          values.releaseDatePrecision,
        )
      : null
  const variants = values.offerings.map((offering) => ({
    allowBackorder: offering.availabilityPolicy !== "inventory_only",
    key: keys.get(offering.id)!,
    options:
      values.kind === "merch"
        ? {
            Size: offering.size,
            ...(usesColor ? { Color: offering.color } : {}),
          }
        : { Format: offering.title },
    prices: [{ amount: Number(offering.priceUsd), currencyCode: "usd" as const }],
    profile: {
      displayLabel: offering.title,
      format: { label: offering.format || (values.kind === "merch" ? "Merch" : offering.title) },
      formatDetail: { label: nullable(offering.formatDetail) },
      preorderAllowed: offering.availabilityPolicy === "preorder",
      preorderReleaseDate:
        offering.availabilityPolicy === "preorder" ? releaseDate : null,
    },
    ...(offering.sku ? { sku: offering.sku } : {}),
    ...(values.kind === "fixed_bundle"
      ? {}
      : { stockQuantity: Number(offering.stockQuantity) }),
    title: offering.title,
  }))
  const tracklist = values.tracklist
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  const description = nullable(values.description)
  const artistId = resolveArtistId(values, vocabulary)
  const genreId = resolveReferenceId(
    values.genreId,
    "genre",
    values.genre,
    vocabulary,
  )
  const labelId = resolveReferenceId(
    values.labelId,
    "label",
    values.label,
    vocabulary,
  )
  const merchandiseTypeId = resolveReferenceId(
    values.merchandiseTypeId,
    "merch_type",
    values.merchandiseType,
    vocabulary,
  )
  const productTypeId = resolveReferenceId(
    values.productTypeId,
    "product_type",
    values.productType,
    vocabulary,
  )
  const releaseYear = releaseDate ? Number(releaseDate.slice(0, 4)) : null
  const references = [
    ...(values.kind === "music_release" && values.genre
      ? [
          {
            kind: "genre",
            ...(genreId
              ? { referenceValueId: genreId }
              : { label: values.genre }),
            sortOrder: 0,
          },
        ]
      : []),
    ...(values.kind === "merch" && values.merchandiseType
      ? [
          {
            kind: "merch_type",
            ...(merchandiseTypeId
              ? { referenceValueId: merchandiseTypeId }
              : { label: values.merchandiseType }),
            sortOrder: 0,
          },
        ]
      : []),
  ]
  const profile: Record<string, unknown> = {
    artists: values.kind === "music_release" && values.artistName
      ? [
          {
            ...(artistId
              ? { artistId, displayName: values.artistName }
              : {
                  displayName: values.artistName,
                  name: values.artistName,
                }),
            role: "primary",
            sortOrder: 0,
          },
        ]
      : [],
    credits:
      values.kind === "music_release" && values.credits
        ? { notes: values.credits }
        : {},
    descriptionHtml: description,
    ...(values.kind === "music_release" && values.label
      ? labelId
        ? { labelId }
        : { label: { label: values.label } }
      : {}),
    merchDetails:
      values.kind === "merch"
        ? {
            care: nullable(values.merchandiseCare),
            fit: nullable(values.merchandiseFit),
            material: nullable(values.material),
            sizeGuide: nullable(values.sizeGuide),
          }
        : {},
    metadata:
      values.kind === "music_release"
        ? { catalog_number: nullable(values.catalogNumber) }
        : {},
    ...(productTypeId
      ? { productTypeId }
      : { productType: { label: values.productType } }),
    references,
    releaseDate,
    releaseDatePrecision:
      values.kind === "music_release"
        ? values.releaseDatePrecision
        : "unknown",
    releaseYear,
    releaseTitle: values.title,
    tracklist: values.kind === "music_release" ? tracklist : [],
  }
  const bundle =
    values.kind === "fixed_bundle"
      ? {
          components: values.bundleComponents.map((component, index) => {
            const product = findProductChoice(choices, component.productId)
            const variant = product?.variants.find(
              (choice) => choice.id === component.variantId,
            )
            if (!product || !variant) {
              throw new Error(
                "An included bundle product is no longer available. Refresh the choices and review the mapping.",
              )
            }
            return {
              bundleVariantKeys: component.offeringIds.map(
                (offeringId) => keys.get(offeringId)!,
              ),
              componentProductId: product.id,
              componentVariantId: variant.id,
              quantity: Number(component.quantity),
              ...(variant.sku ? { sku: variant.sku } : {}),
              sortOrder: index,
              title: product.title,
              variantTitle: variant.title,
            }
          }),
          descriptionHtml: description,
          displayTitle: values.title,
        }
      : values.kind === "mystery_bundle"
        ? {
            components: [],
            descriptionHtml: nullable(
              [values.mysteryPromise, values.mysteryDisclaimer]
                .filter(Boolean)
                .join("\n\n"),
            ),
            displayTitle: values.title,
          }
        : undefined
  const media = values.media.map((item, index) => ({
    altText: item.altText,
    isPrimary: index === 0,
    mediaAssetId: item.mediaAssetId,
    role: index === 0 ? ("primary" as const) : ("gallery" as const),
    sortOrder: index,
  }))

  return {
    ...(bundle ? { bundle } : {}),
    description,
    ...(values.handle ? { handle: values.handle } : {}),
    idempotencyKey,
    kind: values.kind,
    media,
    options,
    profile,
    title: values.title,
    variants,
  }
}

export const catalogCreationStepFields: Array<
  Array<keyof CatalogCreationFormValues>
> = [
  ["kind"],
  [
    "title",
    "description",
    "artistId",
    "productType",
    "productTypeId",
    "artistName",
    "labelId",
    "label",
    "genreId",
    "genre",
    "releaseDate",
    "releaseDatePrecision",
    "catalogNumber",
    "merchandiseType",
    "merchandiseTypeId",
    "handle",
  ],
  ["offerings", "bundleComponents"],
  [
    "tracklist",
    "credits",
    "material",
    "merchandiseFit",
    "merchandiseCare",
    "sizeGuide",
    "mysteryPromise",
    "mysteryDisclaimer",
    "media",
  ],
  [],
]

export const validateCatalogCreationStep = (
  values: CatalogCreationFormValues,
  step: number,
): string[] => {
  const result = catalogCreationFormSchema.safeParse(values)
  if (result.success) {
    return []
  }
  const fields = new Set(catalogCreationStepFields[step] ?? [])
  return result.error.issues
    .filter((issue) => {
      const field = issue.path[0]
      return typeof field === "string" && fields.has(field as keyof CatalogCreationFormValues)
    })
    .map((issue) => issue.message)
}

const DRAFT_VERSION = 4
export const catalogCreationDraftKey = "remorseless:catalog-product-create:v1"
export const catalogCreationDraftTtlMs = 7 * 24 * 60 * 60 * 1_000

const legacyDraftOfferingSchema = z.object({
  allowBackorder: z.boolean(),
  color: z.string().max(100),
  format: z.string().max(100),
  formatDetail: z.string().max(100),
  id: z.string().min(1).max(100),
  priceUsd: z.string().max(100),
  size: z.string().max(100),
  sku: z.string().max(500),
  stockQuantity: z.string().max(100),
  title: z.string().max(500),
})

const draftOfferingSchema = legacyDraftOfferingSchema
  .omit({ allowBackorder: true })
  .extend({
    availabilityPolicy: z.enum(catalogCreationAvailabilityPolicies),
  })

const draftComponentSchema = z.object({
  id: z.string().min(1).max(100),
  offeringIds: z.array(z.string().min(1).max(100)).max(100),
  productId: z.string().max(255),
  quantity: z.string().max(100),
  variantId: z.string().max(255),
})

const draftMediaSchema = z.object({
  altText: z.string().max(MAX_CATALOG_MEDIA_ALT_TEXT_LENGTH),
  byteSize: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  id: z.string().min(1).max(100),
  mediaAssetId: z.string().min(1).max(255),
  mimeType: z.enum(MANAGED_IMAGE_MIME_TYPES),
  originalFilename: z.string().min(1).max(255),
  sourceFileKey: z.string().min(1).max(1_024),
  sourceUrl: z.string().url().max(2_048),
})

const draftValuesShape = {
  artistId: z.string().max(255),
  artistName: z.string().max(500),
  bundleComponents: z.array(draftComponentSchema).max(100),
  catalogNumber: z.string().max(200),
  credits: z.string().max(50_000),
  description: z.string().max(250_000),
  genreId: z.string().max(255),
  genre: z.string().max(200),
  handle: z.string().max(255),
  kind: z.enum(catalogCreationKinds),
  labelId: z.string().max(255),
  label: z.string().max(500),
  material: z.string().max(5_000),
  merchandiseCare: z.string().max(5_000),
  merchandiseFit: z.string().max(5_000),
  merchandiseType: z.string().max(500),
  merchandiseTypeId: z.string().max(255),
  mysteryDisclaimer: z.string().max(10_000),
  mysteryPromise: z.string().max(10_000),
  productTypeId: z.string().max(255),
  productType: z.string().max(500),
  releaseDate: z.string().max(100),
  releaseDatePrecision: z.enum(catalogCreationReleaseDatePrecisions),
  sizeGuide: z.string().max(10_000),
  title: z.string().max(500),
  tracklist: z.string().max(50_000),
}

const draftValuesSchema = z.object({
  ...draftValuesShape,
  media: z.array(draftMediaSchema).max(MAX_CATALOG_PRODUCT_MEDIA_ITEMS),
  offerings: z.array(draftOfferingSchema).min(1).max(100),
})

const versionThreeDraftValuesSchema = z.object({
  ...draftValuesShape,
  offerings: z.array(draftOfferingSchema).min(1).max(100),
})

const versionTwoDraftValuesSchema = z.object({
  ...draftValuesShape,
  offerings: z.array(legacyDraftOfferingSchema).min(1).max(100),
})

const legacyDraftValuesSchema = versionTwoDraftValuesSchema.omit({
  artistId: true,
  genreId: true,
  labelId: true,
  merchandiseType: true,
  merchandiseTypeId: true,
  productTypeId: true,
  releaseDatePrecision: true,
  sizeGuide: true,
})

const storedDraftSchema = z.discriminatedUnion("version", [
  z.object({
    expiresAt: z.number().int().positive(),
    step: z.number().int().min(0).max(4),
    values: legacyDraftValuesSchema,
    version: z.literal(1),
  }),
  z.object({
    expiresAt: z.number().int().positive(),
    step: z.number().int().min(0).max(4),
    values: versionTwoDraftValuesSchema,
    version: z.literal(2),
  }),
  z.object({
    expiresAt: z.number().int().positive(),
    step: z.number().int().min(0).max(4),
    values: versionThreeDraftValuesSchema,
    version: z.literal(3),
  }),
  z.object({
    expiresAt: z.number().int().positive(),
    step: z.number().int().min(0).max(4),
    values: draftValuesSchema,
    version: z.literal(4),
  }),
])

export const serializeCatalogCreationDraft = (
  values: CatalogCreationFormValues,
  step: number,
  now = Date.now(),
): string =>
  JSON.stringify({
    expiresAt: now + catalogCreationDraftTtlMs,
    step,
    values,
    version: DRAFT_VERSION,
  })

export const parseCatalogCreationDraft = (
  serialized: string | null,
  now = Date.now(),
): { step: number; values: CatalogCreationFormValues } | null => {
  if (!serialized) {
    return null
  }
  try {
    const parsed = storedDraftSchema.parse(JSON.parse(serialized))
    if (parsed.expiresAt <= now) {
      return null
    }
    if (parsed.version === DRAFT_VERSION) {
      return { step: parsed.step, values: parsed.values }
    }
    if (parsed.version === 3) {
      return {
        step: parsed.step,
        values: { ...parsed.values, media: [] },
      }
    }
    const legacyValues =
      parsed.version === 1
        ? {
            ...createCatalogCreationDefaults(parsed.values.kind),
            ...parsed.values,
            releaseDatePrecision: parsed.values.releaseDate
              ? ("day" as const)
              : ("unknown" as const),
          }
        : parsed.values
    return {
      step: parsed.step,
      values: {
        ...legacyValues,
        media: [],
        offerings: legacyValues.offerings.map(
          ({ allowBackorder, ...offering }) => ({
            ...offering,
            availabilityPolicy: allowBackorder
              ? ("backorder" as const)
              : ("inventory_only" as const),
          }),
        ),
      },
    }
  } catch {
    return null
  }
}
