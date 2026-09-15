import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import multer from "multer"

import { sendApiProblem } from "../http/correlation"
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_FILES } from "./constraints"

export const managedUploadLimits = {
  fileSize: MAX_UPLOAD_BYTES,
  files: MAX_UPLOAD_FILES,
  fieldNameSize: 100,
  fieldSize: 128,
  fields: 1,
  fieldNestingDepth: 1,
  // The sole metadata field is a scalar idempotency key. Never materialize
  // attacker-sized sparse arrays before the route validates that metadata.
  fieldArrayIndexLimit: 0,
  parts: MAX_UPLOAD_FILES + 1,
} satisfies NonNullable<multer.Options["limits"]> & {
  fieldArrayIndexLimit: number
}

const parseFiles = multer({
  limits: managedUploadLimits,
  storage: multer.memoryStorage(),
}).array("files")

const releaseFailedUploadReferences = (req: MedusaRequest): void => {
  if (Array.isArray(req.files)) {
    // Multer removes buffers from its cleanup copies, but completed request
    // file objects can still retain them. Release those references as well;
    // this does not overwrite or physically erase the uploaded bytes.
    req.files.forEach((file) => {
      Reflect.deleteProperty(file, "buffer")
    })
    req.files.length = 0
  }
  req.body = {}
}

export const parseManagedUpload = (
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): void => {
  parseFiles(req, res, (error: unknown) => {
    if (error !== undefined && error !== null) {
      releaseFailedUploadReferences(req)
    }
    if (!(error instanceof multer.MulterError)) {
      next(error)
      return
    }

    const exceedsLimit =
      error.code.startsWith("LIMIT_") && error.code !== "LIMIT_UNEXPECTED_FILE"
    sendApiProblem(req, res, {
      code: exceedsLimit ? "upload_limit_exceeded" : "invalid_upload",
      title: exceedsLimit ? "Upload limit exceeded" : "Invalid upload",
      status: exceedsLimit ? 413 : 400,
      detail: exceedsLimit
        ? "The upload exceeds the allowed file, field, or multipart limits."
        : "The upload contains an invalid multipart field.",
      instance: req.path,
    })
  })
}
