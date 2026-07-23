import type { MedusaRequest } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import {
  catalogMediaDerivativeStatusValues,
  catalogMediaRoleValues,
  serializeCatalogMediaAsset,
  serializeCatalogProductMediaItem,
  type CatalogMediaAssetRecord,
  type CatalogProductMediaItemRecord,
} from "@/modules/catalog/serializers"
import {
  assertProductExists,
  assertVariantBelongsToProduct,
  coerceJsonRecord,
  firstResult,
  toNullableString,
  toOptionalInteger,
  type CatalogService,
} from "../utils"

export const focalPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
})

export const productMediaInputSchema = z.object({
  mediaAssetId: z.string().trim().optional().nullable(),
  sourceUrl: z.string().trim().url().optional().nullable(),
  sourceFileKey: z.string().trim().optional().nullable(),
  originalFilename: z.string().trim().optional().nullable(),
  mimeType: z.string().trim().optional().nullable(),
  byteSize: z.number().int().min(0).optional().nullable(),
  width: z.number().int().positive().optional().nullable(),
  height: z.number().int().positive().optional().nullable(),
  altText: z.string().trim().optional().nullable(),
  caption: z.string().trim().optional().nullable(),
  focalPoint: focalPointSchema.optional().nullable(),
  cropIntent: z.string().trim().optional().nullable(),
  derivativeStatus: z.enum(catalogMediaDerivativeStatusValues).optional(),
  derivatives: z.record(z.string(), z.unknown()).optional(),
  assetMetadata: z.record(z.string(), z.unknown()).optional(),
  role: z.enum(catalogMediaRoleValues).optional(),
  variantId: z.string().trim().optional().nullable(),
  productProfileId: z.string().trim().optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
  isPrimary: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const productMediaReplaceSchema = z.object({
  media: z.array(productMediaInputSchema).max(100),
})

export type ProductMediaInput = z.infer<typeof productMediaInputSchema>

export const listProductMediaItems = async (
  catalogService: CatalogService,
  productId: string
): Promise<CatalogProductMediaItemRecord[]> =>
  (await catalogService.listCatalogProductMediaItems(
    { product_id: productId },
    { order: { sort_order: "ASC" } }
  )) as CatalogProductMediaItemRecord[]

export const loadProductMediaResponse = async (
  catalogService: CatalogService,
  productId: string
) => {
  const items = await listProductMediaItems(catalogService, productId)
  const assets = await Promise.all(
    items.map(async (item) => {
      try {
        return (await catalogService.retrieveCatalogMediaAsset(
          item.media_asset_id
        )) as CatalogMediaAssetRecord
      } catch {
        return null
      }
    })
  )

  return {
    productId,
    media: items.map((item, index) =>
      serializeCatalogProductMediaItem(item, assets[index] ?? null)
    ),
  }
}

const findReusableAsset = async (
  catalogService: CatalogService,
  input: ProductMediaInput
): Promise<CatalogMediaAssetRecord | null> => {
  const sourceFileKey = toNullableString(input.sourceFileKey)
  if (sourceFileKey) {
    const matches = await catalogService.listCatalogMediaAssets({
      source_file_key: sourceFileKey,
    })
    return (matches.at(0) as CatalogMediaAssetRecord | undefined) ?? null
  }

  const sourceUrl = toNullableString(input.sourceUrl)
  if (sourceUrl) {
    const matches = await catalogService.listCatalogMediaAssets({
      source_url: sourceUrl,
    })
    return (matches.at(0) as CatalogMediaAssetRecord | undefined) ?? null
  }

  return null
}

const buildAssetPayload = (input: ProductMediaInput): Record<string, unknown> => {
  const sourceUrl = toNullableString(input.sourceUrl)
  const payload: Record<string, unknown> = {}

  if (sourceUrl) {
    payload.source_url = sourceUrl
  }
  if (input.sourceFileKey !== undefined) {
    payload.source_file_key = toNullableString(input.sourceFileKey)
  }
  if (input.originalFilename !== undefined) {
    payload.original_filename = toNullableString(input.originalFilename)
  }
  if (input.mimeType !== undefined) {
    payload.mime_type = toNullableString(input.mimeType)
  }
  if (input.byteSize !== undefined) {
    payload.byte_size = toOptionalInteger(input.byteSize)
  }
  if (input.width !== undefined) {
    payload.width = toOptionalInteger(input.width)
  }
  if (input.height !== undefined) {
    payload.height = toOptionalInteger(input.height)
  }
  if (input.altText !== undefined) {
    payload.alt_text = toNullableString(input.altText)
  }
  if (input.caption !== undefined) {
    payload.caption = toNullableString(input.caption)
  }
  if (input.focalPoint !== undefined) {
    payload.focal_x = input.focalPoint?.x ?? null
    payload.focal_y = input.focalPoint?.y ?? null
  }
  if (input.cropIntent !== undefined) {
    payload.crop_intent = toNullableString(input.cropIntent)
  }
  if (input.derivativeStatus !== undefined) {
    payload.derivative_status = input.derivativeStatus
  }
  if (input.derivatives !== undefined) {
    payload.derivatives = coerceJsonRecord(input.derivatives)
  }
  if (input.assetMetadata !== undefined) {
    payload.metadata = coerceJsonRecord(input.assetMetadata)
  }

  return payload
}

const resolveMediaAsset = async (
  catalogService: CatalogService,
  input: ProductMediaInput
): Promise<CatalogMediaAssetRecord> => {
  const mediaAssetId = toNullableString(input.mediaAssetId)
  if (mediaAssetId) {
    const existing = (await catalogService.retrieveCatalogMediaAsset(
      mediaAssetId
    )) as CatalogMediaAssetRecord
    const payload = buildAssetPayload(input)
    if (Object.keys(payload).length > 0) {
      const updated = await catalogService.updateCatalogMediaAssets([
        { id: existing.id, ...payload },
      ])
      return firstResult(updated) as CatalogMediaAssetRecord
    }
    return existing
  }

  const reusable = await findReusableAsset(catalogService, input)
  if (reusable) {
    const payload = buildAssetPayload(input)
    if (Object.keys(payload).length > 0) {
      const updated = await catalogService.updateCatalogMediaAssets([
        { id: reusable.id, ...payload },
      ])
      return firstResult(updated) as CatalogMediaAssetRecord
    }
    return reusable
  }

  const payload = buildAssetPayload(input)
  if (!payload.source_url) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Each media item requires sourceUrl or mediaAssetId"
    )
  }

  const created = await catalogService.createCatalogMediaAssets([payload])
  const asset = firstResult(created) as CatalogMediaAssetRecord | undefined
  if (!asset) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Unable to create catalog media asset"
    )
  }
  return asset
}

const resolveProductProfileId = async (
  catalogService: CatalogService,
  productId: string,
  explicitProductProfileId?: string | null
): Promise<string | null> => {
  const explicit = toNullableString(explicitProductProfileId)
  if (explicit) {
    return explicit
  }

  const profiles = await catalogService.listCatalogProductProfiles({
    product_id: productId,
  })
  return profiles.at(0)?.id ?? null
}

const assertPrimaryShape = (
  inputs: ProductMediaInput[]
): Map<number, boolean> => {
  const primaryByScope = new Set<string>()
  const primaryByIndex = new Map<number, boolean>()
  let firstProductMediaIndex: number | null = null

  inputs.forEach((input, index) => {
    const variantId = toNullableString(input.variantId)
    if (!variantId && firstProductMediaIndex === null) {
      firstProductMediaIndex = index
    }

    const isPrimary = input.isPrimary === true || input.role === "primary"
    if (!isPrimary) {
      primaryByIndex.set(index, false)
      return
    }

    const scope = variantId ? `variant:${variantId}` : "product"
    if (primaryByScope.has(scope)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Only one primary media item is allowed per product or variant"
      )
    }
    primaryByScope.add(scope)
    primaryByIndex.set(index, true)
  })

  if (!primaryByScope.has("product") && firstProductMediaIndex !== null) {
    primaryByIndex.set(firstProductMediaIndex, true)
  }

  return primaryByIndex
}

export const replaceProductMedia = async (
  req: MedusaRequest,
  catalogService: CatalogService,
  productId: string,
  inputs: ProductMediaInput[]
) => {
  await assertProductExists(req, productId)
  const primaryByIndex = assertPrimaryShape(inputs)
  const productProfileId = await resolveProductProfileId(catalogService, productId)
  const resolvedItems: Array<{
    input: ProductMediaInput
    index: number
    variantId: string | null
    asset: CatalogMediaAssetRecord
  }> = []

  for (const [index, input] of inputs.entries()) {
    const variantId = toNullableString(input.variantId)
    if (variantId) {
      await assertVariantBelongsToProduct(req, productId, variantId)
    }

    const asset = await resolveMediaAsset(catalogService, input)
    resolvedItems.push({ input, index, variantId, asset })
  }

  const existing = await listProductMediaItems(catalogService, productId)
  const existingIds = existing.map((item) => item.id)
  if (existingIds.length) {
    await catalogService.deleteCatalogProductMediaItems(existingIds)
  }

  const payloads: Record<string, unknown>[] = []
  for (const item of resolvedItems) {
    const isPrimary = primaryByIndex.get(item.index) ?? false
    payloads.push({
      product_id: productId,
      variant_id: item.variantId,
      product_profile_id:
        toNullableString(item.input.productProfileId) ?? productProfileId,
      media_asset_id: item.asset.id,
      role:
        item.input.role ??
        (item.variantId ? "variant" : isPrimary ? "primary" : "gallery"),
      sort_order: item.input.sortOrder ?? item.index,
      is_primary: isPrimary,
      metadata: coerceJsonRecord(item.input.metadata),
    })
  }

  if (payloads.length) {
    await catalogService.createCatalogProductMediaItems(payloads)
  }

  return await loadProductMediaResponse(catalogService, productId)
}
