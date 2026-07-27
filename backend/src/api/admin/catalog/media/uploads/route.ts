import { createHash } from "node:crypto"

import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import { buildCatalogMediaRemoteFilename } from "@/lib/catalog/product-media-upload"
import { validateManagedImageUploads } from "@/lib/uploads/validation"
import { hashCatalogCommand } from "@/modules/catalog/catalog-command"
import { uploadCatalogProductMediaWorkflow } from "@/workflows/catalog/upload-product-media"

const uploadCommandSchema = z.object({
  idempotencyKey: z.string().uuid(),
})

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
): Promise<void> => {
  const parsed = uploadCommandSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "A valid catalog upload idempotency key is required.",
    )
  }
  const files = validateManagedImageUploads(
    (req.files as Express.Multer.File[] | undefined) ?? [],
  )
  const workflowFiles = files.map((file, index) => ({
    content: file.buffer.toString("base64"),
    filename: file.originalname,
    mimeType: file.mimetype,
    remoteFilename: buildCatalogMediaRemoteFilename(
      parsed.data.idempotencyKey,
      index,
      file.originalname,
    ),
    sha256: createHash("sha256").update(file.buffer).digest("hex"),
    size: file.size,
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
  res.status(201).json({ files: result.files })
}
