import { EntityManager } from "@medusajs/framework/mikro-orm/knex"
import type { Context } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"

import {
  coerceCatalogJsonRecord,
  toCatalogNullableString,
  toCatalogOptionalInteger,
} from "./normalization"
import {
  readCatalogProductProfile,
  readCatalogProductProfiles,
} from "./profile-persistence-contracts"
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
import {
  readCatalogMediaAsset,
  readCatalogMediaAssetMutation,
  readCatalogMediaAssets,
  readCatalogProductMediaOperationResult,
  readCatalogTransactionOperationList,
  readCatalogTransactionOperationMutation,
  readExactCatalogProductMediaItems,
  type CatalogMediaAssetPersistenceRecord,
  type CatalogTransactionOperationExpectation,
} from "./transaction-persistence-contracts"

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
  sharedContext: Context<EntityManager>
): Promise<CatalogMediaAssetPersistenceRecord | null> => {
  const sourceFileKey = toCatalogNullableString(input.sourceFileKey)
  if (sourceFileKey) {
    const matches = readCatalogMediaAssets(
      await catalogService.listCatalogMediaAssets(
        { lifecycle_status: "active", source_file_key: sourceFileKey },
        { take: 2 },
        sharedContext
      ),
      { maximumRows: 1 }
    )
    return matches.at(0) ?? null
  }
  const sourceUrl = toCatalogNullableString(input.sourceUrl)
  if (!sourceUrl) {
    return null
  }
  const matches = readCatalogMediaAssets(
    await catalogService.listCatalogMediaAssets(
      { lifecycle_status: "active", source_url: sourceUrl },
      { take: 2 },
      sharedContext
    ),
    { maximumRows: 1 }
  )
  return matches.at(0) ?? null
}

const buildAssetPatch = (
  input: CatalogProductMediaInput
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
    payload.original_filename = toCatalogNullableString(input.originalFilename)
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
  sharedContext: Context<EntityManager>
): Promise<CatalogMediaAssetPersistenceRecord> => {
  const mediaAssetId = toCatalogNullableString(input.mediaAssetId)
  const patch = buildAssetPatch(input)
  if (mediaAssetId) {
    const existing = readCatalogMediaAsset(
      await catalogService.retrieveCatalogMediaAsset(
        mediaAssetId,
        {},
        sharedContext
      ),
      mediaAssetId
    )
    if (existing.lifecycle_status !== "active") {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "Quarantined catalog media cannot be linked or edited."
      )
    }
    rememberCatalogMediaAsset(previous, existing)
    if (!Object.keys(patch).length) {
      return existing
    }
    const expected = {
      id: existing.id,
      ...patch,
      version: existing.version + 1,
    }
    return readCatalogMediaAssetMutation(
      await catalogService.updateCatalogMediaAssets([expected], sharedContext),
      expected
    )
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
      "Each media item requires sourceUrl or mediaAssetId."
    )
  }
  const asset = readCatalogMediaAssetMutation(
    await catalogService.createCatalogMediaAssets(
      [createPayload],
      sharedContext
    ),
    createPayload
  )
  createdAssetIds.add(asset.id)
  return asset
}

const resolveProductProfileId = async (
  catalogService: CatalogService,
  productId: string,
  explicitProductProfileId: string | null | undefined,
  sharedContext: Context<EntityManager>
): Promise<string | null> => {
  const explicit = toCatalogNullableString(explicitProductProfileId)
  if (explicit) {
    const profile = readCatalogProductProfile(
      await catalogService.retrieveCatalogProductProfile(
        explicit,
        {},
        sharedContext
      ),
      explicit
    )
    if (profile.product_id !== productId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "The selected catalog product profile belongs to another product."
      )
    }
    return explicit
  }
  const profiles = readCatalogProductProfiles(
    await catalogService.listCatalogProductProfiles(
      { product_id: productId },
      { take: 2 },
      sharedContext
    ),
    productId
  )
  return profiles.at(0)?.id ?? null
}

export const assertCatalogProductMediaPrimaryShape = (
  inputs: CatalogProductMediaInput[]
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
        "Only one primary media item is allowed per product or variant."
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
  input: CatalogProductMediaMutationInput
): Promise<CatalogProductMediaMutationResult> =>
  catalogService.runCatalogTransaction(async (sharedContext) => {
    const operationExpectation: CatalogTransactionOperationExpectation = {
      actorId: input.actorId,
      aggregateId: input.aggregateId,
      command: input.command,
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      requestSha256: input.requestSha256,
      status: "pending",
    }
    const existingOperation = readCatalogTransactionOperationList(
      await catalogService.listCatalogAuthoringOperations(
        { idempotency_key: input.idempotencyKey },
        { take: 2 },
        sharedContext
      )
    )
    if (existingOperation) {
      const sameCommand =
        existingOperation.command === input.command &&
        existingOperation.aggregateId === input.aggregateId &&
        existingOperation.actorId === input.actorId &&
        existingOperation.expectedVersion === input.expectedVersion &&
        existingOperation.requestSha256 === input.requestSha256
      if (!sameCommand || existingOperation.status !== "succeeded") {
        throw new MedusaError(
          MedusaError.Types.CONFLICT,
          "The catalog idempotency key cannot be replayed for this product media command."
        )
      }
      const result = readCatalogProductMediaOperationResult(
        existingOperation.result,
        input.aggregateId
      )
      return {
        createdAssetIds: [],
        operationId: existingOperation.id,
        previous: { assets: [], items: [] },
        productId: input.aggregateId,
        replayed: true,
        result,
        version: result.version,
      }
    }

    const currentVersion = await resolveCatalogProductMediaVersion(
      catalogService,
      input.aggregateId,
      sharedContext
    )
    if (currentVersion !== input.expectedVersion) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "The product media changed after it was loaded. Refresh before saving."
      )
    }
    const previous = await snapshotCatalogProductMedia(
      catalogService,
      input.aggregateId,
      sharedContext
    )
    const operation = readCatalogTransactionOperationMutation(
      await catalogService.createCatalogAuthoringOperations(
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
        sharedContext
      ),
      operationExpectation
    )

    const primaryByIndex = assertCatalogProductMediaPrimaryShape(input.media)
    const createdAssetIds = new Set<string>()
    const defaultProductProfileId = await resolveProductProfileId(
      catalogService,
      input.aggregateId,
      undefined,
      sharedContext
    )
    const resolvedItems = []
    for (const [index, media] of input.media.entries()) {
      const asset = await resolveMediaAsset(
        catalogService,
        media,
        previous,
        createdAssetIds,
        sharedContext
      )
      const productProfileId =
        media.productProfileId === undefined
          ? defaultProductProfileId
          : await resolveProductProfileId(
              catalogService,
              input.aggregateId,
              media.productProfileId,
              sharedContext
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
        sharedContext
      )
    }
    const itemPayloads = resolvedItems.map(
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
            (variantId ? "variant" : isPrimary ? "primary" : "gallery"),
          sort_order: media.sortOrder ?? index,
          variant_id: variantId,
        }
      }
    )
    if (itemPayloads.length) {
      readExactCatalogProductMediaItems(
        await catalogService.createCatalogProductMediaItems(
          itemPayloads,
          sharedContext
        ),
        input.aggregateId,
        itemPayloads
      )
    }
    readExactCatalogProductMediaItems(
      await catalogService.listCatalogProductMediaItems(
        { product_id: input.aggregateId },
        { order: { id: "ASC", sort_order: "ASC" }, take: 101 },
        sharedContext
      ),
      input.aggregateId,
      itemPayloads
    )

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
  }
): Promise<void> =>
  catalogService.runCatalogTransaction(async (sharedContext) => {
    const operation = readCatalogTransactionOperationList(
      await catalogService.listCatalogAuthoringOperations(
        { id: input.operationId },
        { take: 2 },
        sharedContext
      )
    )
    if (
      !operation ||
      operation.id !== input.operationId ||
      operation.status !== "pending"
    ) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The product media compensation operation could not be verified."
      )
    }
    await restoreCatalogProductMediaSnapshot(
      catalogService,
      input.aggregateId,
      input.previous,
      sharedContext
    )
    for (const assetId of input.createdAssetIds) {
      await deleteCreatedMediaAssetIfOrphaned(
        catalogService,
        assetId,
        sharedContext
      )
    }
    readCatalogTransactionOperationMutation(
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
        sharedContext
      ),
      { ...operation, id: input.operationId, status: "compensated" }
    )
  })
