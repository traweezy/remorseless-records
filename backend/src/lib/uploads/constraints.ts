export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024
export const MAX_UPLOAD_FILES = 10
export const MAX_UPLOAD_TOTAL_BYTES = 20 * 1024 * 1024

export const MANAGED_IMAGE_MIME_TYPES = [
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const

export type ManagedImageMimeType =
  (typeof MANAGED_IMAGE_MIME_TYPES)[number]
