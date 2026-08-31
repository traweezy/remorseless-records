import { randomUUID } from "node:crypto"

import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import type { FileTypes } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"

import { MANAGED_IMAGE_MIME_TYPES } from "../../../lib/uploads/constraints"
import { normalizeManagedImageUploads } from "../../../lib/uploads/image-normalization"
import { validateManagedUploads } from "../../../lib/uploads/validation"

const managedImageMimeTypes = new Set<string>(MANAGED_IMAGE_MIME_TYPES)

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const logger = (() => {
    try {
      return req.scope.resolve<{
        info?: (message: string) => void
        warn?: (message: string) => void
      }>("logger")
    } catch {
      return null
    }
  })()
  const files = validateManagedUploads(
    (req.files as Express.Multer.File[] | undefined) ?? []
  )
  const imageFiles = files.filter(({ mimetype }) =>
    managedImageMimeTypes.has(mimetype)
  )
  if (imageFiles.length && imageFiles.length !== files.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Image and CSV uploads must use separate requests."
    )
  }
  const fileService = req.scope.resolve<FileTypes.IFileModuleService>(
    Modules.FILE
  )
  const startedAt = Date.now()
  let normalizedImages: Awaited<
    ReturnType<typeof normalizeManagedImageUploads>
  > = []
  if (imageFiles.length) {
    try {
      normalizedImages = await normalizeManagedImageUploads(imageFiles)
    } catch (error) {
      logger?.warn?.(
        JSON.stringify({
          duration_ms: Date.now() - startedAt,
          event: "managed_image.normalization",
          file_count: imageFiles.length,
          result: "rejected",
          route_class: "admin:managed-upload",
        })
      )
      throw error
    }
    logger?.info?.(
      JSON.stringify({
        duration_ms: Date.now() - startedAt,
        event: "managed_image.normalization",
        file_count: normalizedImages.length,
        input_bytes: imageFiles.reduce((total, file) => total + file.size, 0),
        output_bytes: normalizedImages.reduce(
          (total, file) => total + file.size,
          0
        ),
        result: "accepted",
        route_class: "admin:managed-upload",
      })
    )
  }
  const uploadInputs = normalizedImages.length
    ? normalizedImages.map((file, index) => ({
        access: "public" as const,
        content: file.buffer.toString("base64"),
        filename: `managed-${randomUUID()}-${index}.webp`,
        mimeType: file.mimeType,
      }))
    : files.map((file, index) => ({
        access: "public" as const,
        content: file.buffer.toString("base64"),
        filename: `managed-${randomUUID()}-${index}.csv`,
        mimeType: "text/csv",
      }))
  const result = await fileService.createFiles(uploadInputs)
  res.status(200).json({ files: result })
}
