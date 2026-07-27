import { MedusaError } from "@medusajs/framework/utils"

const DEFAULT_BUCKET = "medusa-media"
const DEFAULT_REGION = "us-east-1"
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/

export type ObjectStorageConfig = {
  accessKeyId: string
  bucket: string
  endpoint: string
  fileUrl: string
  region: string
  secretAccessKey: string
}

type StorageEnvironment = {
  MINIO_ACCESS_KEY?: string
  MINIO_BUCKET?: string
  MINIO_ENDPOINT?: string
  MINIO_FILE_URL?: string
  MINIO_REGION?: string
  MINIO_SECRET_KEY?: string
}

const normalizeUrl = (
  raw: string,
  label: string,
  { allowPath = false }: { allowPath?: boolean } = {}
): string => {
  let url: URL
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`)
  } catch {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `${label} must be a valid HTTP(S) URL.`
    )
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `${label} must use HTTP or HTTPS.`
    )
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `${label} must not contain credentials, query parameters, or fragments.`
    )
  }
  if (!allowPath && url.pathname !== "/") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `${label} must not contain a path.`
    )
  }

  return url.toString().replace(/\/+$/, "")
}

export const resolveObjectStorageConfig = ({
  environment = process.env,
  required = process.env.NODE_ENV === "production",
}: {
  environment?: StorageEnvironment
  required?: boolean
} = {}): ObjectStorageConfig | null => {
  const endpoint = environment.MINIO_ENDPOINT?.trim() ?? ""
  const accessKeyId = environment.MINIO_ACCESS_KEY?.trim() ?? ""
  const secretAccessKey = environment.MINIO_SECRET_KEY?.trim() ?? ""
  const configuredValues = [endpoint, accessKeyId, secretAccessKey]
  const hasAny = configuredValues.some(Boolean)
  const hasAll = configuredValues.every(Boolean)

  if (!hasAny && !required) {
    return null
  }
  if (!hasAll) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "MINIO_ENDPOINT, MINIO_ACCESS_KEY, and MINIO_SECRET_KEY must be configured together."
    )
  }

  const bucket = environment.MINIO_BUCKET?.trim() || DEFAULT_BUCKET
  if (!BUCKET_PATTERN.test(bucket)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "MINIO_BUCKET must be a valid S3 bucket name."
    )
  }

  const normalizedEndpoint = normalizeUrl(endpoint, "MINIO_ENDPOINT")
  const configuredFileUrl = environment.MINIO_FILE_URL?.trim()
  const fileUrl = configuredFileUrl
    ? normalizeUrl(configuredFileUrl, "MINIO_FILE_URL", { allowPath: true })
    : `${normalizedEndpoint}/${bucket}`

  return {
    accessKeyId,
    bucket,
    endpoint: normalizedEndpoint,
    fileUrl,
    region: environment.MINIO_REGION?.trim() || DEFAULT_REGION,
    secretAccessKey,
  }
}
