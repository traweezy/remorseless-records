import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import {
  serializeCatalogVariantProfile,
} from "@/modules/catalog/serializers"
import {
  assertVariantExists,
  coerceJsonRecord,
  createOrReuseReferenceValue,
  firstResult,
  toNullableString,
  toOptionalDate,
  type CatalogService,
} from "../../../utils"

const namedReferenceInputSchema = z.object({
  referenceValueId: z.string().trim().optional().nullable(),
  label: z.string().trim().optional().nullable(),
  value: z.string().trim().optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
})

const variantProfileUpsertSchema = z.object({
  productProfileId: z.string().trim().optional().nullable(),
  productId: z.string().trim().optional().nullable(),
  formatId: z.string().trim().optional().nullable(),
  format: namedReferenceInputSchema.optional().nullable(),
  formatDetailId: z.string().trim().optional().nullable(),
  formatDetail: namedReferenceInputSchema.optional().nullable(),
  formatLabel: z.string().trim().optional().nullable(),
  formatDetailLabel: z.string().trim().optional().nullable(),
  displayLabel: z.string().trim().optional().nullable(),
  preorderAllowed: z.boolean().optional(),
  preorderReleaseDate: z.string().trim().optional().nullable(),
  backorderAllowed: z.boolean().optional(),
  backorderNote: z.string().trim().optional().nullable(),
  imageUrl: z.string().trim().url().optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
})

const resolveVariantProfile = async (
  catalogService: CatalogService,
  variantId: string
) => {
  const profiles = await catalogService.listCatalogVariantProfiles({
    variant_id: variantId,
  })
  return profiles.at(0) ?? null
}

const resolveProductProfileId = async (
  catalogService: CatalogService,
  input: {
    productProfileId?: string | null | undefined
    productId?: string | null | undefined
  }
): Promise<string | null | undefined> => {
  if (input.productProfileId === null || input.productId === null) {
    return null
  }

  const productProfileId = toNullableString(input.productProfileId)
  if (productProfileId) {
    await catalogService.retrieveCatalogProductProfile(productProfileId)
    return productProfileId
  }

  const productId = toNullableString(input.productId)
  if (!productId) {
    return undefined
  }

  const profiles = await catalogService.listCatalogProductProfiles({
    product_id: productId,
  })
  const profile = profiles.at(0)
  if (!profile) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Catalog product profile not found"
    )
  }

  return profile.id
}

const resolveFormatReferenceId = async (
  catalogService: CatalogService,
  input: {
    id?: string | null | undefined
    kind: "format" | "format_detail"
    reference?: z.infer<typeof namedReferenceInputSchema> | null | undefined
  }
): Promise<string | null | undefined> => {
  if (input.id === null || input.reference === null) {
    return null
  }

  const referenceValueId = toNullableString(input.id)
  if (referenceValueId) {
    return referenceValueId
  }

  if (!input.reference) {
    return undefined
  }

  const value = await createOrReuseReferenceValue(catalogService, {
    referenceValueId: input.reference.referenceValueId,
    kind: input.kind,
    label: input.reference.label,
    value: input.reference.value,
    metadata: coerceJsonRecord(input.reference.metadata),
  })

  return value?.id ?? null
}

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const variantId = req.params.variant_id
  if (!variantId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Product variant id is required"
    )
  }

  await assertVariantExists(req, variantId)
  const catalogService = req.scope.resolve("catalog") as CatalogService
  const profile = await resolveVariantProfile(catalogService, variantId)
  res.status(200).json({
    profile: profile ? serializeCatalogVariantProfile(profile) : null,
  })
}

export const PUT = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const variantId = req.params.variant_id
  if (!variantId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Product variant id is required"
    )
  }

  const parsed = variantProfileUpsertSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid catalog variant profile payload"
    )
  }

  await assertVariantExists(req, variantId)
  const catalogService = req.scope.resolve("catalog") as CatalogService
  const existing = await resolveVariantProfile(catalogService, variantId)
  const productProfileId = await resolveProductProfileId(catalogService, {
    productProfileId: parsed.data.productProfileId,
    productId: parsed.data.productId,
  })
  const formatId = await resolveFormatReferenceId(catalogService, {
    id: parsed.data.formatId,
    kind: "format",
    reference: parsed.data.format,
  })
  const formatDetailId = await resolveFormatReferenceId(catalogService, {
    id: parsed.data.formatDetailId,
    kind: "format_detail",
    reference: parsed.data.formatDetail,
  })

  const payload: Record<string, unknown> = {
    variant_id: variantId,
    availability_status: "available",
  }

  if (productProfileId !== undefined) {
    payload.product_profile_id = productProfileId
  }
  if (formatId !== undefined) {
    payload.format_id = formatId
  }
  if (formatDetailId !== undefined) {
    payload.format_detail_id = formatDetailId
  }
  if (parsed.data.formatLabel !== undefined) {
    payload.format_label = toNullableString(parsed.data.formatLabel)
  }
  if (parsed.data.formatDetailLabel !== undefined) {
    payload.format_detail_label = toNullableString(parsed.data.formatDetailLabel)
  }
  if (parsed.data.displayLabel !== undefined) {
    payload.display_label = toNullableString(parsed.data.displayLabel)
  }
  if (parsed.data.preorderAllowed !== undefined) {
    payload.preorder_allowed = parsed.data.preorderAllowed
  }
  if (parsed.data.preorderReleaseDate !== undefined) {
    payload.preorder_release_date = toOptionalDate(
      parsed.data.preorderReleaseDate
    )
  }
  if (parsed.data.backorderAllowed !== undefined) {
    payload.backorder_allowed = parsed.data.backorderAllowed
  }
  if (parsed.data.backorderNote !== undefined) {
    payload.backorder_note = toNullableString(parsed.data.backorderNote)
  }
  if (parsed.data.imageUrl !== undefined) {
    payload.image_url = toNullableString(parsed.data.imageUrl)
  }
  if (parsed.data.metadata !== undefined) {
    payload.metadata = coerceJsonRecord(parsed.data.metadata)
  }

  const savedResult = existing
    ? await catalogService.updateCatalogVariantProfiles([
        {
          id: existing.id,
          ...payload,
        },
      ])
    : await catalogService.createCatalogVariantProfiles([payload])
  const saved = firstResult(savedResult)

  if (!saved) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Unable to save catalog variant profile"
    )
  }

  res.status(existing ? 200 : 201).json({
    profile: serializeCatalogVariantProfile(saved),
  })
}

export const DELETE = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const variantId = req.params.variant_id
  if (!variantId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Product variant id is required"
    )
  }

  const catalogService = req.scope.resolve("catalog") as CatalogService
  const profile = await resolveVariantProfile(catalogService, variantId)
  if (!profile) {
    res.sendStatus(204)
    return
  }

  await catalogService.deleteCatalogVariantProfiles(profile.id)
  res.sendStatus(204)
}
