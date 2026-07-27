import path from "node:path"

import { MedusaError } from "@medusajs/framework/utils"

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024
export const MAX_UPLOAD_FILES = 10
export const MAX_UPLOAD_TOTAL_BYTES = 20 * 1024 * 1024

const IMAGE_EXTENSIONS: Record<string, ReadonlySet<string>> = {
  "image/gif": new Set([".gif"]),
  "image/jpeg": new Set([".jpeg", ".jpg"]),
  "image/png": new Set([".png"]),
  "image/webp": new Set([".webp"]),
}
const CSV_MIME_TYPES = new Set([
  "application/csv",
  "application/vnd.ms-excel",
  "text/csv",
  "text/plain",
])
const CSV_EXTENSIONS = new Set([".csv"])

const invalidUpload = (message: string): never => {
  throw new MedusaError(MedusaError.Types.INVALID_DATA, message)
}

const hasBytes = (buffer: Buffer, expected: number[], offset = 0): boolean =>
  expected.every((byte, index) => buffer[offset + index] === byte)

const hasImageSignature = (mimeType: string, buffer: Buffer): boolean => {
  if (mimeType === "image/jpeg") {
    return hasBytes(buffer, [0xff, 0xd8, 0xff])
  }
  if (mimeType === "image/png") {
    return hasBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  }
  if (mimeType === "image/webp") {
    return (
      hasBytes(buffer, [0x52, 0x49, 0x46, 0x46]) &&
      hasBytes(buffer, [0x57, 0x45, 0x42, 0x50], 8)
    )
  }
  if (mimeType === "image/gif") {
    const header = buffer.subarray(0, 6).toString("ascii")
    return header === "GIF87a" || header === "GIF89a"
  }
  return false
}

const isValidUtf8Text = (buffer: Buffer): boolean => {
  if (buffer.includes(0)) {
    return false
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer)
    return true
  } catch {
    return false
  }
}

const validateFilename = (filename: string): string => {
  if (
    !filename ||
    filename.length > 255 ||
    filename !== path.basename(filename) ||
    /[\u0000-\u001f\u007f/\\]/u.test(filename)
  ) {
    invalidUpload("An uploaded file has an invalid filename.")
  }
  return path.extname(filename).toLowerCase()
}

const validateFile = (file: Express.Multer.File): void => {
  if (!file.buffer.length || file.size !== file.buffer.length) {
    invalidUpload("An uploaded file is empty or incomplete.")
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    invalidUpload("Each uploaded file must be 12 MiB or smaller.")
  }

  const extension = validateFilename(file.originalname)
  const imageExtensions = IMAGE_EXTENSIONS[file.mimetype]
  if (imageExtensions) {
    if (!imageExtensions.has(extension)) {
      invalidUpload("An uploaded image extension does not match its media type.")
    }
    if (!hasImageSignature(file.mimetype, file.buffer)) {
      invalidUpload("An uploaded image does not match its declared media type.")
    }
    return
  }

  if (
    CSV_MIME_TYPES.has(file.mimetype) &&
    CSV_EXTENSIONS.has(extension) &&
    isValidUtf8Text(file.buffer)
  ) {
    return
  }
  invalidUpload(
    "Only JPEG, PNG, WebP, GIF, and UTF-8 CSV uploads are supported."
  )
}

export const validateManagedUploads = (
  files: Express.Multer.File[]
): Express.Multer.File[] => {
  if (!files.length) {
    invalidUpload("No files were uploaded.")
  }
  if (files.length > MAX_UPLOAD_FILES) {
    invalidUpload(`No more than ${MAX_UPLOAD_FILES} files can be uploaded.`)
  }
  const totalBytes = files.reduce((total, file) => total + file.size, 0)
  if (totalBytes > MAX_UPLOAD_TOTAL_BYTES) {
    invalidUpload("The combined upload must be 20 MiB or smaller.")
  }
  files.forEach(validateFile)
  return files
}

export const validateManagedImageUploads = (
  files: Express.Multer.File[]
): Express.Multer.File[] => {
  const validated = validateManagedUploads(files)
  if (validated.some(({ mimetype }) => !IMAGE_EXTENSIONS[mimetype])) {
    invalidUpload("Catalog media uploads must be JPEG, PNG, WebP, or GIF images.")
  }
  return validated
}
