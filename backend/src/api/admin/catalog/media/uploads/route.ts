import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import { buildCatalogMediaRemoteFilename } from "@/lib/catalog/product-media-upload"
import { readCatalogMediaUploadOperationResult } from "@/lib/catalog/transaction-persistence-contracts"
import { normalizeManagedImageUploads } from "@/lib/uploads/image-normalization"
import { validateManagedImageUploads } from "@/lib/uploads/validation"
import { hashCatalogCommand } from "@/modules/catalog/catalog-command"
import { uploadCatalogProductMediaWorkflow } from "../../../../../workflows/catalog/upload-product-media"

const uploadCommandSchema = z.object({
  idempotencyKey: z.string().uuid(),
})

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
  const parsed = uploadCommandSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "A valid catalog upload idempotency key is required."
    )
  }
  const validatedFiles = validateManagedImageUploads(
    (req.files as Express.Multer.File[] | undefined) ?? []
  )
  const startedAt = Date.now()
  let files: Awaited<ReturnType<typeof normalizeManagedImageUploads>>
  try {
    files = await normalizeManagedImageUploads(validatedFiles)
  } catch (error) {
    logger?.warn?.(
      JSON.stringify({
        duration_ms: Date.now() - startedAt,
        event: "managed_image.normalization",
        file_count: validatedFiles.length,
        result: "rejected",
        route_class: "admin:catalog-media-upload",
      })
    )
    throw error
  }
  logger?.info?.(
    JSON.stringify({
      duration_ms: Date.now() - startedAt,
      event: "managed_image.normalization",
      file_count: files.length,
      input_bytes: validatedFiles.reduce((total, file) => total + file.size, 0),
      output_bytes: files.reduce((total, file) => total + file.size, 0),
      result: "accepted",
      route_class: "admin:catalog-media-upload",
    })
  )
  const workflowFiles = files.map((file, index) => ({
    content: file.buffer.toString("base64"),
    filename: file.source.filename,
    height: file.height,
    mimeType: file.mimeType,
    remoteFilename: buildCatalogMediaRemoteFilename(
      parsed.data.idempotencyKey,
      index
    ),
    sha256: file.sha256,
    size: file.size,
    source: file.source,
    width: file.width,
  }))
  const requestSha256 = hashCatalogCommand({
    command: "catalog.product-media.upload",
    files: workflowFiles.map(({ content: _content, ...file }) => file),
  })
  const actorId = req.auth_context?.actor_id ?? null
  const { result } = await uploadCatalogProductMediaWorkflow(req.scope).run({
    context: {
      idempotencyKey: parsed.data.idempotencyKey,
      requestId: parsed.data.idempotencyKey,
    },
    input: {
      actorId,
      files: workflowFiles,
      idempotencyKey: parsed.data.idempotencyKey,
      requestSha256,
    },
  })
  const persistedFiles = readCatalogMediaUploadOperationResult(
    { files: result.files },
    workflowFiles
  )
  res.status(201).json({ files: persistedFiles })
}
