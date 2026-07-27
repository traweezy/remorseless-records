import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import type { FileTypes } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

import { validateManagedUploads } from "../../../lib/uploads/validation"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const files = validateManagedUploads(
    (req.files as Express.Multer.File[] | undefined) ?? []
  )
  const fileService = req.scope.resolve<FileTypes.IFileModuleService>(
    Modules.FILE
  )
  const result = await fileService.createFiles(
    files.map((file) => ({
      access: "public" as const,
      content: file.buffer.toString("base64"),
      filename: file.originalname,
      mimeType: file.mimetype,
    }))
  )
  res.status(200).json({ files: result })
}
