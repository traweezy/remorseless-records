import { EntityManager } from "@medusajs/framework/mikro-orm/knex"
import type { Context } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"

import type { CatalogMediaAssetRecord } from "../../modules/catalog/serializers"
import {
  coerceCatalogJsonRecord,
  firstCatalogResult,
  toCatalogNullableString,
  toCatalogOptionalInteger,
} from "./normalization"
import {
  catalogFocalPointSchema,
  catalogProductMediaInputSchema,
  catalogProductMediaReplaceSchema,
  type CatalogProductMediaInput,
  type CatalogProductMediaMutationInput,
  type CatalogProductMediaMutationResult,
} from "./product-media-contract"
import {
  deleteCreatedMediaAssetIfOrphaned,
  loadCatalogProductMediaResponse,
  rememberCatalogMediaAsset,
  resolveCatalogProductMediaVersion,
  restoreCatalogProductMediaSnapshot,
  snapshotCatalogProductMedia,
} from "./product-media-state"
import type { CatalogService } from "./reference-resolution"

export {
  catalogFocalPointSchema,
  catalogProductMediaInputSchema,
  catalogProductMediaReplaceSchema,
  loadCatalogProductMediaResponse,
}
export type {
  CatalogMediaAssetState,
  CatalogProductMediaInput,
  CatalogProductMediaItemState,
  CatalogProductMediaMutationInput,
  CatalogProductMediaMutationResult,
  CatalogProductMediaSnapshot,
} from "./product-media-contract"

const findReusableAsset = async (
  catalogService: CatalogService,
  input: CatalogProductMediaInput,
  sharedContext: Context<EntityManager>,
): Promise<CatalogMediaAssetRecord | null> => {
  const sourceFileKey = toCatalogNullableString(input.sourceFileKey)
  if (sourceFileKey) {
    const matches = await catalogService.listCatalogMediaAssets(
      { source_file_key: sourceFileKey },
      { take: 1 },
      sharedContext,
    )
    return (matches.at(0) as CatalogMediaAssetRecord | undefined) ?? null
  }
  const sourceUrl = toCatalogNullableString(input.sourceUrl)
  if (!sourceUrl) {
    return null
  }
  const matches = await catalogService.listCatalogMediaAssets(
    { source_url: sourceUrl },
    { take: 1 },
    sharedContext,
  )
  return (matches.at(0) as CatalogMediaAssetRecord | undefined) ?? null
}

const buildAssetPatch = (
  input: CatalogProductMediaInput,
): Record<string, unknown> => {
  const payload: Record<string, unknown> = {}
  const sourceUrl = toCatalogNullableString(input.sourceUrl)
  if (sourceUrl) {
    payload.source_url = sourceUrl
  }
  if (input.sourceFileKey !== undefined) {
    payload.source_file_key = toCatalogNullableString(input.sourceFileKey)
  }
  if (input.originalFilename !== undefined) {
    payload.original_filename = toCatalogNullableString(
      input.originalFilename,
    )
  }
  if (input.mimeType !== undefined) {
    payload.mime_type = toCatalogNullableString(input.mimeType)
  }
  if (input.byteSize !== undefined) {
    payload.byte_size = toCatalogOptionalInteger(input.byteSize)
  }
  if (input.width !== undefined) {
    payload.width = toCatalogOptionalInteger(input.width)
  }
  if (input.height !== undefined) {
    payload.height = toCatalogOptionalInteger(input.height)
  }
  if (input.altText !== undefined) {
    payload.alt_text = toCatalogNullableString(input.altText)
  }
  if (input.caption !== undefined) {
    payload.caption = toCatalogNullableString(input.caption)
  }
  if (input.focalPoint !== undefined) {
    payload.focal_x = input.focalPoint?.x ?? null
    payload.focal_y = input.focalPoint?.y ?? null
  }
  if (input.cropIntent !== undefined) {
    payload.crop_intent = toCatalogNullableString(input.cropIntent)
  }
  if (input.derivativeStatus !== undefined) {
    payload.derivative_status = input.derivativeStatus
  }
  if (input.derivatives !== undefined) {
    payload.derivatives = coerceCatalogJsonRecord(input.derivatives)
  }
  if (input.assetMetadata !== undefined) {
    payload.metadata = coerceCatalogJsonRecord(input.assetMetadata)
  }
  return payload
}

const resolveMediaAsset = async (
  catalogService: CatalogService,
  input: CatalogProductMediaInput,
  previous: CatalogProductMediaMutationResult["previous"],
  createdAssetIds: Set<string>,
  sharedContext: Context<EntityManager>,
): Promise<CatalogMediaAssetRecord> => {
  const mediaAssetId = toCatalogNullableString(input.mediaAssetId)
  const patch = buildAssetPatch(input)
  if (mediaAssetId) {
    const existing = (await catalogService.retrieveCatalogMediaAsset(
        mediaAssetId,
        {},
        sharedContext,
      )) as CatalogMediaAssetRecord
    rememberCatalogMediaAsset(previous, existing)
    if (!Object.keys(patch).length) {
      return existing
    }
    const updated = await catalogService.updateCatalogMediaAssets(
      [{ id: existing.id, ...patch, version: existing.version + 1 }],
      sharedContext,
    )
    const asset = firstCatalogResult(updated) as
      | CatalogMediaAssetRecord
      | undefined
    if (!asset) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Unable to update catalog media asset.",
      )
    }
    return asset
  }

  const reusable = await findReusableAsset(catalogService, input, sharedContext)
  const createPayload = reusable
    ? {
        alt_text: reusable.alt_text,
        byte_size: reusable.byte_size,
        caption: reusable.caption,
        content_sha256: reusable.content_sha256,
        crop_intent: reusable.crop_intent,
        derivative_status: reusable.derivative_status,
        derivatives: coerceCatalogJsonRecord(reusable.derivatives),
        focal_x: reusable.focal_x,
        focal_y: reusable.focal_y,
        height: reusable.height,
        metadata: coerceCatalogJsonRecord(reusable.metadata),
        mime_type: reusable.mime_type,
        original_filename: reusable.original_filename,
        source_file_key: reusable.source_file_key,
        source_url: reusable.source_url,
        version: 1,
        width: reusable.width,
        ...patch,
      }
    : patch
  if (!createPayload.source_url) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Each media item requires sourceUrl or mediaAssetId.",
    )
  }
  const created = await catalogService.createCatalogMediaAssets(
    [createPayload],
    sharedContext,
  )
  const asset = firstCatalogResult(created) as
    | CatalogMediaAssetRecord
    | undefined
  if (!asset) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Unable to create catalog media asset.",
    )
  }
  createdAssetIds.add(asset.id)
  return asset
}

const resolveProductProfileId = async (
  catalogService: CatalogService,
  productId: string,
  explicitProductProfileId: string | null | undefined,
  sharedContext: Context<EntityManager>,
): Promise<string | null> => {
  const explicit = toCatalogNullableString(explicitProductProfileId)
  if (explicit) {
    const profile = await catalogService.retrieveCatalogProductProfile(
      explicit,
      {},
      sharedContext,
    )
    if (profile.product_id !== productId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "The selected catalog product profile belongs to another product.",
      )
    }
    return explicit
  }
  const profiles = await catalogService.listCatalogProductProfiles(
    { product_id: productId },
    { take: 1 },
    sharedContext,
  )
  return profiles.at(0)?.id ?? null
}

export const assertCatalogProductMediaPrimaryShape = (
  inputs: CatalogProductMediaInput[],
): Map<number, boolean> => {
  const primaryByScope = new Set<string>()
  const primaryByIndex = new Map<number, boolean>()
  let firstProductMediaIndex: number | null = null

  inputs.forEach((input, index) => {
    const variantId = toCatalogNullableString(input.variantId)
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
        "Only one primary media item is allowed per product or variant.",
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

export const mutateCatalogProductMedia = async (
  catalogService: CatalogService,
  input: CatalogProductMediaMutationInput,
): Promise<CatalogProductMediaMutationResult> =>
  catalogService.runCatalogTransaction(async (sharedContext) => {
    const existingOperation = (
      await catalogService.listCatalogAuthoringOperations(
        { idempotency_key: input.idempotencyKey },
        { take: 1 },
        sharedContext,
      )
    )[0]
    if (existingOperation) {
      const sameCommand =
        existingOperation.command === input.command &&
        existingOperation.aggregate_id === input.aggregateId &&
        existingOperation.actor_id === input.actorId &&
        existingOperation.expected_version === input.expectedVersion &&
        existingOperation.request_sha256 === input.requestSha256
      if (!sameCommand || existingOperation.status !== "succeeded") {
        throw new MedusaError(
          MedusaError.Types.CONFLICT,
          "The catalog idempotency key cannot be replayed for this product media command.",
        )
      }
      const result = coerceCatalogJsonRecord(existingOperation.result)
      return {
        createdAssetIds: [],
        operationId: existingOperation.id,
        previous: { assets: [], items: [] },
        productId: input.aggregateId,
        replayed: true,
        result,
        version:
          typeof result.version === "number"
            ? result.version
            : input.expectedVersion,
      }
    }

    const currentVersion = await resolveCatalogProductMediaVersion(
      catalogService,
      input.aggregateId,
      sharedContext,
    )
    if (currentVersion !== input.expectedVersion) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "The product media changed after it was loaded. Refresh before saving.",
      )
    }
    const previous = await snapshotCatalogProductMedia(
      catalogService,
      input.aggregateId,
      sharedContext,
    )
    const [operation] = await catalogService.createCatalogAuthoringOperations(
      [
        {
          actor_id: input.actorId,
          aggregate_id: input.aggregateId,
          command: input.command,
          expected_version: input.expectedVersion,
          idempotency_key: input.idempotencyKey,
          metadata: {},
          request_sha256: input.requestSha256,
          result: {},
          status: "pending",
        },
      ],
      sharedContext,
    )
    if (!operation) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The product media command audit record was not created.",
      )
    }

    const primaryByIndex = assertCatalogProductMediaPrimaryShape(input.media)
    const createdAssetIds = new Set<string>()
    const defaultProductProfileId = await resolveProductProfileId(
      catalogService,
      input.aggregateId,
      undefined,
      sharedContext,
    )
    const resolvedItems = []
    for (const [index, media] of input.media.entries()) {
      const asset = await resolveMediaAsset(
        catalogService,
        media,
        previous,
        createdAssetIds,
        sharedContext,
      )
      const productProfileId =
        media.productProfileId === undefined
          ? defaultProductProfileId
          : await resolveProductProfileId(
              catalogService,
              input.aggregateId,
              media.productProfileId,
              sharedContext,
            )
      resolvedItems.push({
        asset,
        index,
        media,
        productProfileId,
        variantId: toCatalogNullableString(media.variantId),
      })
    }

    if (previous.items.length) {
      await catalogService.deleteCatalogProductMediaItems(
        previous.items.map(({ id }) => id),
        sharedContext,
      )
    }
    if (resolvedItems.length) {
      await catalogService.createCatalogProductMediaItems(
        resolvedItems.map(
          ({ asset, index, media, productProfileId, variantId }) => {
            const isPrimary = primaryByIndex.get(index) ?? false
            return {
              is_primary: isPrimary,
              media_asset_id: asset.id,
              metadata: coerceCatalogJsonRecord(media.metadata),
              product_id: input.aggregateId,
              product_profile_id: productProfileId,
              role:
                media.role ??
                (variantId
                  ? "variant"
                  : isPrimary
                    ? "primary"
                    : "gallery"),
              sort_order: media.sortOrder ?? index,
              variant_id: variantId,
            }
          },
        ),
        sharedContext,
      )
    }

    return {
      createdAssetIds: [...createdAssetIds],
      operationId: operation.id,
      previous,
      productId: input.aggregateId,
      replayed: false,
      result: {},
      version: currentVersion + 1,
    }
  })

export const compensateCatalogProductMediaMutation = async (
  catalogService: CatalogService,
  input: {
    aggregateId: string
    createdAssetIds: string[]
    operationId: string
    previous: CatalogProductMediaMutationResult["previous"]
  },
): Promise<void> =>
  catalogService.runCatalogTransaction(async (sharedContext) => {
    await restoreCatalogProductMediaSnapshot(
      catalogService,
      input.aggregateId,
      input.previous,
      sharedContext,
    )
    for (const assetId of input.createdAssetIds) {
      await deleteCreatedMediaAssetIfOrphaned(
        catalogService,
        assetId,
        sharedContext,
      )
    }
    await catalogService.updateCatalogAuthoringOperations(
      [
        {
          completed_at: new Date(),
          error_code: "workflow_compensated",
          error_detail:
            "A later workflow step failed; the previous product media state was restored.",
          id: input.operationId,
          status: "compensated",
        },
      ],
      sharedContext,
    )
  })
