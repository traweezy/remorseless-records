import { z } from "zod"

const boundedIdentifier = z.string().trim().min(1).max(200)
const boundedText = z.string().trim().min(1).max(500)

export const bundleAvailabilityOptionSchema = z
  .object({
    variantId: boundedIdentifier,
    title: boundedText,
    sku: z.string().trim().min(1).max(200).nullable(),
    availableQuantity: z.number().int().min(0).max(10_000_000).nullable(),
    available: z.boolean(),
  })
  .strict()

export const bundleVariantAvailabilitySchema = z
  .object({
    bundleVariantIds: z.array(boundedIdentifier).min(1).max(100),
    bundleVariantTitles: z.array(boundedText).min(1).max(100),
    selectionMode: z.enum(["exact", "any"]),
    available: z.boolean(),
    options: z.array(bundleAvailabilityOptionSchema).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.bundleVariantIds.length !== value.bundleVariantTitles.length) {
      context.addIssue({
        code: "custom",
        message: "Bundle variant identities and titles must align",
      })
    }
    if (
      new Set(value.bundleVariantIds).size !== value.bundleVariantIds.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Bundle variant identities must be unique",
      })
    }
    const optionIds = value.options.map((option) => option.variantId)
    if (new Set(optionIds).size !== optionIds.length) {
      context.addIssue({
        code: "custom",
        message: "Bundle availability options must be unique",
      })
    }
    const calculatedAvailability =
      value.selectionMode === "any"
        ? value.options.some((option) => option.available)
        : value.options.length > 0 &&
          value.options.every((option) => option.available)
    if (value.available !== calculatedAvailability) {
      context.addIssue({
        code: "custom",
        message: "Bundle availability does not match its options",
      })
    }
  })

export const bundleCompositionItemSchema = z
  .object({
    id: boundedIdentifier,
    title: boundedText,
    quantity: z.number().int().min(1).max(10_000),
    required: z.boolean(),
    product: z
      .object({
        id: boundedIdentifier.nullable(),
        handle: boundedIdentifier.nullable(),
        title: boundedText.nullable(),
      })
      .strict()
      .refine(
        (product) =>
          product.id === null
            ? product.handle === null && product.title === null
            : product.handle !== null && product.title !== null,
        { message: "Bundle component product fields must be complete" }
      ),
    availabilityByBundleVariant: z
      .array(bundleVariantAvailabilitySchema)
      .max(100),
  })
  .strict()

export const bundleCompositionSchema = z
  .object({
    productId: boundedIdentifier,
    handle: boundedIdentifier,
    title: boundedText,
    type: boundedIdentifier,
    componentCount: z.number().int().min(0).max(100),
    unavailableMappingCount: z.number().int().min(0).max(10_000),
    hasUnavailableComponents: z.boolean(),
    components: z.array(bundleCompositionItemSchema).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    const componentIds = value.components.map((component) => component.id)
    if (new Set(componentIds).size !== componentIds.length) {
      context.addIssue({
        code: "custom",
        message: "Bundle components must be unique",
      })
    }
    if (value.componentCount !== value.components.length) {
      context.addIssue({
        code: "custom",
        message: "Bundle component count does not match its components",
      })
    }
    const unavailableMappingCount = value.components.reduce(
      (total, component) =>
        total +
        component.availabilityByBundleVariant.filter(
          (availability) => !availability.available
        ).length,
      0
    )
    if (value.unavailableMappingCount !== unavailableMappingCount) {
      context.addIssue({
        code: "custom",
        message: "Bundle unavailable mapping count is inconsistent",
      })
    }
    if (value.hasUnavailableComponents !== value.unavailableMappingCount > 0) {
      context.addIssue({
        code: "custom",
        message: "Bundle unavailable state is inconsistent",
      })
    }
  })

export const bundleCompositionResponseSchema = z
  .object({
    bundle: bundleCompositionSchema.nullable(),
  })
  .strict()

export type BundleAvailabilityOption = z.infer<
  typeof bundleAvailabilityOptionSchema
>
export type BundleVariantAvailability = z.infer<
  typeof bundleVariantAvailabilitySchema
>
export type BundleCompositionItem = z.infer<typeof bundleCompositionItemSchema>
export type BundleComposition = z.infer<typeof bundleCompositionSchema>
