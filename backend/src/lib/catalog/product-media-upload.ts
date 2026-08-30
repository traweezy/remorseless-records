import type { FileTypes } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"

import type CatalogModuleService from "../../modules/catalog/service"
import { MANAGED_IMAGE_NORMALIZER_VERSION } from "../uploads/image-normalization"
import { coerceCatalogJsonRecord } from "./normalization"

type CatalogService = InstanceType<typeof CatalogModuleService>

export type CatalogMediaUploadFileInput = {
  content: string
  filename: string
  height: number
  mimeType: string
  remoteFilename: string
  sha256: string
  size: number
  source: {
    channels: number
    filename: string
    format: "gif" | "jpeg" | "png" | "webp"
    frames: number
    height: number
    mimeType: string
    sha256: string
    size: number
    width: number
  }
  width: number
}

export type CatalogMediaUploadResultFile = {
  filename: string
  id: string
  mediaAssetId: string
  mimeType: string
  size: number
  url: string
}

export type CatalogMediaUploadInput = {
  actorId: string | null
  files: CatalogMediaUploadFileInput[]
  idempotencyKey: string
  requestSha256: string
}

export type CatalogMediaUploadMutationResult = {
  files: CatalogMediaUploadResultFile[]
  operationId: string
  replayed: boolean
}

export type CatalogMediaUploadCompensation = {
  assetIds: string[]
  fileIds: string[]
  operationId: string | null
}

export class CatalogMediaUploadPartialFailure extends Error {
  readonly compensation: CatalogMediaUploadCompensation

  constructor(compensation: CatalogMediaUploadCompensation, cause: unknown) {
    super("Unable to persist the catalog media upload.", { cause })
    this.name = "CatalogMediaUploadPartialFailure"
    this.compensation = compensation
  }
}

export const buildCatalogMediaRemoteFilename = (
  idempotencyKey: string,
  index: number
): string => `${idempotencyKey}-${String(index).padStart(2, "0")}.webp`

export const performCatalogMediaUpload = async (
  catalogService: CatalogService,
  fileService: FileTypes.IFileModuleService,
  input: CatalogMediaUploadInput
): Promise<{
  compensation: CatalogMediaUploadCompensation | null
  mutation: CatalogMediaUploadMutationResult
}> => {
  const existingOperation = (
    await catalogService.listCatalogAuthoringOperations(
      { idempotency_key: input.idempotencyKey },
      { take: 1 }
    )
  )[0]
  if (existingOperation) {
    const matches =
      existingOperation.command === "catalog.product-media.upload" &&
      existingOperation.aggregate_id === input.idempotencyKey &&
      existingOperation.actor_id === input.actorId &&
      existingOperation.expected_version === 0 &&
      existingOperation.request_sha256 === input.requestSha256
    if (!matches || existingOperation.status !== "succeeded") {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "The catalog upload idempotency key cannot be replayed."
      )
    }
    const result = coerceCatalogJsonRecord(existingOperation.result)
    const files = Array.isArray(result.files)
      ? (result.files as CatalogMediaUploadResultFile[])
      : []
    return {
      compensation: null,
      mutation: {
        files,
        operationId: existingOperation.id,
        replayed: true,
      },
    }
  }

  const [operation] = await catalogService.createCatalogAuthoringOperations([
    {
      actor_id: input.actorId,
      aggregate_id: input.idempotencyKey,
      command: "catalog.product-media.upload",
      expected_version: 0,
      idempotency_key: input.idempotencyKey,
      metadata: {
        file_sha256s: input.files.map(({ sha256 }) => sha256),
        remote_prefix: input.idempotencyKey,
        source_file_sha256s: input.files.map(({ source }) => source.sha256),
      },
      request_sha256: input.requestSha256,
      result: {},
      status: "pending",
    },
  ])
  if (!operation) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "The catalog upload audit record was not created."
    )
  }

  const compensation: CatalogMediaUploadCompensation = {
    assetIds: [],
    fileIds: [],
    operationId: operation.id,
  }
  const files: CatalogMediaUploadResultFile[] = []
  try {
    for (const file of input.files) {
      const uploaded = await fileService.createFiles({
        access: "public",
        content: file.content,
        filename: file.remoteFilename,
        mimeType: file.mimeType,
      })
      compensation.fileIds.push(uploaded.id)
      const [asset] = await catalogService.createCatalogMediaAssets([
        {
          byte_size: file.size,
          content_sha256: file.sha256,
          derivative_status: "source_only",
          height: file.height,
          metadata: {
            safety_pipeline: {
              normalized_format: "webp",
              normalized_sha256: file.sha256,
              status: "passed",
              validation: "strict-decode-reencode",
              version: MANAGED_IMAGE_NORMALIZER_VERSION,
            },
            source: {
              channels: file.source.channels,
              format: file.source.format,
              frames: file.source.frames,
              height: file.source.height,
              mime_type: file.source.mimeType,
              sha256: file.source.sha256,
              size: file.source.size,
              width: file.source.width,
            },
            upload_idempotency_key: input.idempotencyKey,
          },
          mime_type: file.mimeType,
          original_filename: file.filename,
          source_file_key: uploaded.id,
          source_url: uploaded.url,
          width: file.width,
        },
      ])
      if (!asset) {
        throw new Error("Catalog media asset was not created.")
      }
      compensation.assetIds.push(asset.id)
      files.push({
        filename: file.filename,
        id: uploaded.id,
        mediaAssetId: asset.id,
        mimeType: file.mimeType,
        size: file.size,
        url: uploaded.url,
      })
    }
  } catch (error) {
    throw new CatalogMediaUploadPartialFailure(compensation, error)
  }

  return {
    compensation,
    mutation: {
      files,
      operationId: operation.id,
      replayed: false,
    },
  }
}

export const compensateCatalogMediaUpload = async (
  catalogService: CatalogService,
  fileService: FileTypes.IFileModuleService,
  compensation: CatalogMediaUploadCompensation
): Promise<void> => {
  let cleanupError: unknown
  try {
    if (compensation.assetIds.length) {
      await catalogService.deleteCatalogMediaAssets(compensation.assetIds)
    }
  } catch (error) {
    cleanupError = error
  }
  try {
    if (compensation.fileIds.length) {
      await fileService.deleteFiles(compensation.fileIds)
    }
  } catch (error) {
    cleanupError ??= error
  }
  try {
    if (compensation.operationId) {
      const cleanupFailed = Boolean(cleanupError)
      await catalogService.updateCatalogAuthoringOperations([
        {
          completed_at: new Date(),
          error_code: cleanupFailed
            ? "workflow_compensation_failed"
            : "workflow_compensated",
          error_detail: cleanupFailed
            ? "Catalog upload cleanup requires operator reconciliation."
            : "The catalog upload failed and its created assets were removed.",
          id: compensation.operationId,
          result: {
            compensation: {
              asset_ids: compensation.assetIds,
              file_ids: compensation.fileIds,
            },
          },
          status: cleanupFailed ? "failed" : "compensated",
        },
      ])
    }
  } catch (error) {
    cleanupError ??= error
  }
  if (cleanupError) {
    throw cleanupError
  }
}
