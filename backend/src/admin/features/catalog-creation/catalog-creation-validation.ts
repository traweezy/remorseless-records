import {
  catalogCreationFormSchema,
  catalogCreationStepFields,
  type CatalogCreationFormValues,
} from "./catalog-product-create-form"

export type CatalogCreationValidationIssue = {
  key: string
  message: string
  path: Array<number | string>
  step: number
  targetId: string | null
}

const fieldTargets = {
  artistId: "catalog-create-artist",
  artistName: "catalog-create-artist",
  catalogNumber: "catalog-create-number",
  credits: "catalog-create-credits",
  description: "catalog-create-description",
  genre: "catalog-create-genre",
  genreId: "catalog-create-genre",
  handle: "catalog-create-handle",
  kind: "catalog-create-kind",
  label: "catalog-create-label",
  labelId: "catalog-create-label",
  material: "catalog-create-material",
  merchandiseCare: "catalog-create-care",
  merchandiseFit: "catalog-create-fit",
  merchandiseType: "catalog-create-merch-type",
  merchandiseTypeId: "catalog-create-merch-type",
  mysteryDisclaimer: "catalog-create-disclaimer",
  mysteryPromise: "catalog-create-promise",
  productType: "catalog-create-product-type",
  productTypeId: "catalog-create-product-type",
  releaseDate: "catalog-create-date",
  releaseDatePrecision: "catalog-create-date-precision",
  sizeGuide: "catalog-create-size-guide",
  title: "catalog-create-title",
  tracklist: "catalog-create-tracklist",
} satisfies Partial<Record<keyof CatalogCreationFormValues, string>>

const offeringFieldTargets = {
  availabilityPolicy: "availability-policy",
  color: "color",
  format: "format",
  formatDetail: "detail",
  priceUsd: "price",
  size: "size",
  sku: "sku",
  stockQuantity: "stock",
  title: "title",
} as const

const componentFieldTargets = {
  offeringIds: "offerings",
  productId: "product",
  quantity: "quantity",
  variantId: "variant",
} as const

const resolveStep = (field: keyof CatalogCreationFormValues): number => {
  const step = catalogCreationStepFields.findIndex((fields) =>
    fields.includes(field)
  )
  return step >= 0 ? step : 4
}

const resolveOfferingTarget = (
  values: CatalogCreationFormValues,
  path: Array<number | string>
): string | null => {
  const index = path[1]
  if (typeof index !== "number") {
    return values.offerings[0]
      ? `offering-${values.offerings[0].id}-title`
      : "catalog-create-add-offering"
  }
  const offering = values.offerings[index]
  if (!offering) {
    return "catalog-create-add-offering"
  }
  const field = path[2]
  const fallback = values.kind === "merch" ? "size" : "format"
  const suffix =
    typeof field === "string" && field in offeringFieldTargets
      ? offeringFieldTargets[field as keyof typeof offeringFieldTargets]
      : fallback
  return `offering-${offering.id}-${suffix}`
}

const resolveComponentTarget = (
  values: CatalogCreationFormValues,
  path: Array<number | string>
): string => {
  const index = path[1]
  if (typeof index !== "number") {
    return "catalog-create-add-bundle-component"
  }
  const component = values.bundleComponents[index]
  if (!component) {
    return "catalog-create-add-bundle-component"
  }
  const field = path[2]
  const suffix =
    typeof field === "string" && field in componentFieldTargets
      ? componentFieldTargets[field as keyof typeof componentFieldTargets]
      : "product"
  return `component-${component.id}-${suffix}`
}

const resolveMediaTarget = (
  values: CatalogCreationFormValues,
  path: Array<number | string>
): string => {
  const index = path[1]
  const item = typeof index === "number" ? values.media[index] : undefined
  return item
    ? `catalog-create-media-alt-${item.id}`
    : "catalog-create-upload-media"
}

const resolveTarget = (
  values: CatalogCreationFormValues,
  path: Array<number | string>
): string | null => {
  const field = path[0]
  if (field === "offerings") {
    return resolveOfferingTarget(values, path)
  }
  if (field === "bundleComponents") {
    return resolveComponentTarget(values, path)
  }
  if (field === "media") {
    return resolveMediaTarget(values, path)
  }
  return typeof field === "string" && field in fieldTargets
    ? fieldTargets[field as keyof typeof fieldTargets]
    : null
}

export const resolveCatalogCreationValidationIssues = (
  values: CatalogCreationFormValues,
  step?: number
): CatalogCreationValidationIssue[] => {
  const result = catalogCreationFormSchema.safeParse(values)
  if (result.success) {
    return []
  }
  return result.error.issues
    .map((issue) => {
      const path = issue.path.filter(
        (part): part is number | string =>
          typeof part === "number" || typeof part === "string"
      )
      const field = path[0]
      const issueStep =
        typeof field === "string"
          ? resolveStep(field as keyof CatalogCreationFormValues)
          : 4
      return {
        key: `${path.join(".")}:${issue.message}`,
        message: issue.message,
        path,
        step: issueStep,
        targetId: resolveTarget(values, path),
      }
    })
    .filter((issue) => step === undefined || issue.step === step)
}

export const createCatalogCreationGeneralIssue = (
  message: string,
  step: number
): CatalogCreationValidationIssue => ({
  key: `general:${step}:${message}`,
  message,
  path: [],
  step,
  targetId: null,
})
