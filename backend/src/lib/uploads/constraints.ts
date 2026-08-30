export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024
export const MAX_UPLOAD_FILES = 10
export const MAX_UPLOAD_TOTAL_BYTES = 20 * 1024 * 1024

export const MAX_IMAGE_CHANNELS = 4
export const MAX_IMAGE_DECOMPRESSED_BYTES = 128 * 1024 * 1024
export const MAX_IMAGE_FRAMES = 1
export const MAX_IMAGE_INPUT_DIMENSION = 12_000
export const MAX_IMAGE_INPUT_PIXELS = 32_000_000
export const MAX_IMAGE_OUTPUT_DIMENSION = 3_000
export const MAX_NORMALIZED_IMAGE_BYTES = 8 * 1024 * 1024
export const IMAGE_PROCESSING_TIMEOUT_MS = 8_000
export const IMAGE_PROCESSING_LIBVIPS_TIMEOUT_SECONDS = 6
export const IMAGE_SANDBOX_ADDRESS_SPACE_BYTES = 2 * 1024 * 1024 * 1024
export const IMAGE_SANDBOX_CPU_SECONDS = 10
export const MANAGED_IMAGE_OUTPUT_MIME_TYPE = "image/webp" as const

export const MANAGED_IMAGE_MIME_TYPES = [
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const

export type ManagedImageMimeType =
  (typeof MANAGED_IMAGE_MIME_TYPES)[number]
