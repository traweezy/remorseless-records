import { z } from "zod"

export const catalogCreationKinds = [
  "music_release",
  "merch",
  "fixed_bundle",
  "mystery_bundle",
] as const

export type CatalogCreationKind = (typeof catalogCreationKinds)[number]

export type CatalogCreationOffering = {
  allowBackorder: boolean
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

export type CatalogCreationFormValues = {
  artistName: string
  catalogNumber: string
  credits: string
  description: string
  genre: string
  handle: string
  kind: CatalogCreationKind
  label: string
  material: string
  merchandiseCare: string
  merchandiseFit: string
  mysteryDisclaimer: string
  mysteryPromise: string
  offerings: CatalogCreationOffering[]
  productType: string
  releaseDate: string
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

const key = (): string => crypto.randomUUID()

const defaultOffering = (kind: CatalogCreationKind): CatalogCreationOffering => {
  if (kind === "merch") {
    return {
      allowBackorder: false,
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
    allowBackorder: false,
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
  artistName: "",
  bundleComponents: [],
  catalogNumber: "",
  credits: "",
  description: "",
  genre: "",
  handle: "",
  kind,
  label: "Remorseless Records",
  material: "",
  merchandiseCare: "",
  merchandiseFit: "",
  mysteryDisclaimer: "",
  mysteryPromise: "",
  offerings: [defaultOffering(kind)],
  productType: productTypeForKind(kind),
  releaseDate: "",
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

const offeringSchema = z.object({
  allowBackorder: z.boolean(),
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

export const catalogCreationFormSchema = z
  .object({
    artistName: z.string().trim().max(500),
    bundleComponents: z.array(componentSchema).max(100),
    catalogNumber: z.string().trim().max(200),
    credits: z.string().trim().max(50_000),
    description: z.string().trim().max(250_000),
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
    label: z.string().trim().max(500),
    material: z.string().trim().max(5_000),
    merchandiseCare: z.string().trim().max(5_000),
    merchandiseFit: z.string().trim().max(5_000),
    mysteryDisclaimer: z.string().trim().max(10_000),
    mysteryPromise: z.string().trim().max(10_000),
    offerings: z.array(offeringSchema).min(1).max(100),
    productType: z.string().trim().min(1, "Choose a product type.").max(500),
    releaseDate: z
      .string()
      .trim()
      .refine(
        (value) => !value || Number.isFinite(Date.parse(value)),
        "Enter a valid release date.",
      ),
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
    const combinations = new Set<string>()
    values.offerings.forEach((offering, index) => {
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

export const buildCatalogProductCreateRequest = (
  rawValues: CatalogCreationFormValues,
  idempotencyKey: string,
  choices: CatalogCreationProductChoice[],
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
  const variants = values.offerings.map((offering) => ({
    allowBackorder: offering.allowBackorder,
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
  const profile: Record<string, unknown> = {
    artists: values.artistName
      ? [
          {
            displayName: values.artistName,
            name: values.artistName,
            role: "primary",
            sortOrder: 0,
          },
        ]
      : [],
    credits: values.credits ? { notes: values.credits } : {},
    descriptionHtml: description,
    label: { label: nullable(values.label) },
    merchDetails:
      values.kind === "merch"
        ? {
            care: nullable(values.merchandiseCare),
            fit: nullable(values.merchandiseFit),
            material: nullable(values.material),
          }
        : {},
    metadata: { catalog_number: nullable(values.catalogNumber) },
    productType: { label: values.productType },
    references: values.genre
      ? [{ kind: "genre", label: values.genre, sortOrder: 0 }]
      : [],
    releaseDate: nullable(values.releaseDate),
    releaseDatePrecision: values.releaseDate ? "day" : "unknown",
    releaseTitle: values.title,
    tracklist,
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

  return {
    ...(bundle ? { bundle } : {}),
    description,
    ...(values.handle ? { handle: values.handle } : {}),
    idempotencyKey,
    kind: values.kind,
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
    "productType",
    "artistName",
    "label",
    "genre",
    "releaseDate",
    "catalogNumber",
    "handle",
  ],
  ["offerings", "bundleComponents"],
  [
    "tracklist",
    "credits",
    "material",
    "merchandiseFit",
    "merchandiseCare",
    "mysteryPromise",
    "mysteryDisclaimer",
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

const DRAFT_VERSION = 1
export const catalogCreationDraftKey = "remorseless:catalog-product-create:v1"
export const catalogCreationDraftTtlMs = 7 * 24 * 60 * 60 * 1_000

const draftOfferingSchema = z.object({
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

const draftComponentSchema = z.object({
  id: z.string().min(1).max(100),
  offeringIds: z.array(z.string().min(1).max(100)).max(100),
  productId: z.string().max(255),
  quantity: z.string().max(100),
  variantId: z.string().max(255),
})

const draftValuesSchema = z.object({
  artistName: z.string().max(500),
  bundleComponents: z.array(draftComponentSchema).max(100),
  catalogNumber: z.string().max(200),
  credits: z.string().max(50_000),
  description: z.string().max(250_000),
  genre: z.string().max(200),
  handle: z.string().max(255),
  kind: z.enum(catalogCreationKinds),
  label: z.string().max(500),
  material: z.string().max(5_000),
  merchandiseCare: z.string().max(5_000),
  merchandiseFit: z.string().max(5_000),
  mysteryDisclaimer: z.string().max(10_000),
  mysteryPromise: z.string().max(10_000),
  offerings: z.array(draftOfferingSchema).min(1).max(100),
  productType: z.string().max(500),
  releaseDate: z.string().max(100),
  title: z.string().max(500),
  tracklist: z.string().max(50_000),
})

const storedDraftSchema = z.object({
  expiresAt: z.number().int().positive(),
  step: z.number().int().min(0).max(4),
  values: draftValuesSchema,
  version: z.literal(DRAFT_VERSION),
})

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
    return { step: parsed.step, values: parsed.values }
  } catch {
    return null
  }
}
