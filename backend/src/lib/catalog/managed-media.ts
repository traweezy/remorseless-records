import { createHash } from "node:crypto"
import path from "node:path"

export const BIG_CARTEL_ASSET_HOST = "assets.bigcartel.com"
export const MANAGED_MEDIA_MASTER_WIDTH = 2_000
export const MEDIA_CUTOVER_CONFIRMATION = "replace-big-cartel-runtime-media"
export const MEDIA_STAGE_CONFIRMATION = "stage-big-cartel-managed-media"
export const DEFAULT_MEDIA_MAX_BYTES = 20 * 1024 * 1024

export const managedMediaUsagePlan = {
  masterWidth: MANAGED_MEDIA_MASTER_WIDTH,
  largestRenderedWidth: 520,
  largestExpectedDevicePixelRatio: 3,
  responsiveWidths: [56, 64, 80, 96, 320, 480, 640, 750, 828, 1_080, 1_200],
  runtimeDerivativeOwner: "next-image",
} as const

export type SupportedManagedImage = {
  extension: ".jpg" | ".png" | ".webp"
  height: number
  mimeType: "image/jpeg" | "image/png" | "image/webp"
  width: number
}

export type ManagedMediaCommandOptions = {
  apply: boolean
  confirmation: string | null
  maxAssets: number | null
  maxBytes: number
  minDelayMs: number
  probeCount: number
  requestTimeoutMs: number
  stage: boolean
  stageConfirmation: string | null
  stateDirectory: string | null
}

const normalizeCommandArguments = (args: unknown[]): string[] =>
  args
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(
      (entry) =>
        entry.length > 0 &&
        entry !== "exec" &&
        entry !== "./exec" &&
        !entry.endsWith("/exec")
    )

const readOption = (args: string[], name: string): string | null => {
  const prefix = `${name}=`
  const inline = args.find((entry) => entry.startsWith(prefix))
  if (inline) {
    return inline.slice(prefix.length)
  }

  const index = args.indexOf(name)
  const next = index >= 0 ? args[index + 1] : null
  return next && !next.startsWith("--") ? next : null
}

const readIntegerOption = (
  args: string[],
  name: string,
  fallback: number,
  range: { max: number; min: number }
): number => {
  const raw = readOption(args, name)
  if (raw === null) {
    return fallback
  }
  const parsed = Number.parseInt(raw, 10)
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < range.min ||
    parsed > range.max
  ) {
    throw new Error(
      `${name} must be an integer from ${range.min} through ${range.max}.`
    )
  }
  return parsed
}

export const parseManagedMediaCommandOptions = (
  rawArgs: unknown[]
): ManagedMediaCommandOptions => {
  const args = normalizeCommandArguments(rawArgs)
  const apply = args.includes("--apply")
  const stage = args.includes("--stage")
  const confirmation = readOption(args, "--confirm-cutover")
  const stageConfirmation = readOption(args, "--confirm-stage")
  const maxAssetsRaw = readOption(args, "--max-assets")
  const maxAssets =
    maxAssetsRaw === null
      ? null
      : readIntegerOption(args, "--max-assets", 0, {
          min: 1,
          max: 100_000,
        })

  if (apply && confirmation !== MEDIA_CUTOVER_CONFIRMATION) {
    throw new Error(
      `Applying the managed-media cutover requires --confirm-cutover=${MEDIA_CUTOVER_CONFIRMATION}.`
    )
  }
  if (stage && stageConfirmation !== MEDIA_STAGE_CONFIRMATION) {
    throw new Error(
      `Staging managed media requires --confirm-stage=${MEDIA_STAGE_CONFIRMATION}.`
    )
  }
  if (apply && stage) {
    throw new Error("--apply and --stage are mutually exclusive.")
  }
  if (apply && maxAssets !== null) {
    throw new Error(
      "--max-assets is a probe/testing limit and cannot be combined with --apply."
    )
  }

  return {
    apply,
    confirmation,
    maxAssets,
    maxBytes: readIntegerOption(
      args,
      "--max-bytes",
      DEFAULT_MEDIA_MAX_BYTES,
      { min: 1_024, max: 100 * 1024 * 1024 }
    ),
    minDelayMs: readIntegerOption(args, "--min-delay-ms", 1_000, {
      min: 500,
      max: 60_000,
    }),
    probeCount: readIntegerOption(args, "--probe", 0, {
      min: 0,
      max: 25,
    }),
    requestTimeoutMs: readIntegerOption(
      args,
      "--request-timeout-ms",
      20_000,
      { min: 1_000, max: 120_000 }
    ),
    stage,
    stageConfirmation,
    stateDirectory: readOption(args, "--state-dir"),
  }
}

export const selectBigCartelManagedMasterUrl = (value: string): string => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("Big Cartel media URL is invalid.")
  }

  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== BIG_CARTEL_ASSET_HOST ||
    !url.pathname.startsWith("/product_images/")
  ) {
    throw new Error(
      `Only HTTPS ${BIG_CARTEL_ASSET_HOST}/product_images sources are supported.`
    )
  }

  url.username = ""
  url.password = ""
  url.hash = ""
  url.search = ""
  url.searchParams.set("auto", "format")
  url.searchParams.set("fit", "max")
  url.searchParams.set("w", String(MANAGED_MEDIA_MASTER_WIDTH))
  return url.toString()
}

export const isBigCartelProductImageUrl = (value: unknown): value is string => {
  if (typeof value !== "string" || !value.trim()) {
    return false
  }
  try {
    selectBigCartelManagedMasterUrl(value)
    return true
  } catch {
    return false
  }
}

const readPngMetadata = (buffer: Buffer): SupportedManagedImage | null => {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) {
    return null
  }
  return {
    extension: ".png",
    height: buffer.readUInt32BE(20),
    mimeType: "image/png",
    width: buffer.readUInt32BE(16),
  }
}

const jpegStartOfFrameMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
  0xcf,
])

const readJpegMetadata = (buffer: Buffer): SupportedManagedImage | null => {
  if (
    buffer.length < 4 ||
    buffer[0] !== 0xff ||
    buffer[1] !== 0xd8
  ) {
    return null
  }

  let offset = 2
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }
    while (buffer[offset] === 0xff) {
      offset += 1
    }
    const marker = buffer[offset]
    offset += 1
    if (marker === undefined || marker === 0xd9 || marker === 0xda) {
      break
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue
    }
    if (offset + 2 > buffer.length) {
      break
    }
    const segmentLength = buffer.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      break
    }
    if (jpegStartOfFrameMarkers.has(marker) && segmentLength >= 7) {
      return {
        extension: ".jpg",
        height: buffer.readUInt16BE(offset + 3),
        mimeType: "image/jpeg",
        width: buffer.readUInt16BE(offset + 5),
      }
    }
    offset += segmentLength
  }
  throw new Error("JPEG dimensions could not be read from the file header.")
}

const readWebpMetadata = (buffer: Buffer): SupportedManagedImage | null => {
  if (
    buffer.length < 30 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return null
  }

  const chunk = buffer.toString("ascii", 12, 16)
  if (chunk === "VP8X") {
    return {
      extension: ".webp",
      height: 1 + buffer.readUIntLE(27, 3),
      mimeType: "image/webp",
      width: 1 + buffer.readUIntLE(24, 3),
    }
  }
  if (chunk === "VP8L" && buffer[20] === 0x2f) {
    const b1 = buffer[21] ?? 0
    const b2 = buffer[22] ?? 0
    const b3 = buffer[23] ?? 0
    const b4 = buffer[24] ?? 0
    return {
      extension: ".webp",
      height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
      mimeType: "image/webp",
      width: 1 + (((b2 & 0x3f) << 8) | b1),
    }
  }
  if (
    chunk === "VP8 " &&
    buffer[23] === 0x9d &&
    buffer[24] === 0x01 &&
    buffer[25] === 0x2a
  ) {
    return {
      extension: ".webp",
      height: buffer.readUInt16LE(28) & 0x3fff,
      mimeType: "image/webp",
      width: buffer.readUInt16LE(26) & 0x3fff,
    }
  }
  throw new Error("WebP dimensions could not be read from the file header.")
}

export const inspectManagedImage = (
  buffer: Buffer,
  declaredContentType: string | null
): SupportedManagedImage => {
  const inspected =
    readPngMetadata(buffer) ??
    readJpegMetadata(buffer) ??
    readWebpMetadata(buffer)

  if (!inspected) {
    throw new Error("The downloaded bytes are not a supported JPEG, PNG, or WebP image.")
  }
  if (inspected.width < 1 || inspected.height < 1) {
    throw new Error("The downloaded image has invalid dimensions.")
  }

  const declaredMimeType =
    declaredContentType?.split(";", 1)[0]?.trim().toLowerCase() ?? null
  if (
    declaredMimeType &&
    declaredMimeType !== "application/octet-stream" &&
    declaredMimeType !== inspected.mimeType
  ) {
    throw new Error(
      `Declared content type ${declaredMimeType} does not match ${inspected.mimeType} bytes.`
    )
  }
  return inspected
}

export const hashManagedMedia = (buffer: Buffer): string =>
  createHash("sha256").update(buffer).digest("hex")

export const resolveDeduplicatedManagedUpload = async <T>(
  uploadsBySha: Map<string, Promise<T>>,
  sha256: string,
  createUpload: () => Promise<T>
): Promise<T> => {
  const existing = uploadsBySha.get(sha256)
  if (existing) {
    return existing
  }
  const upload = createUpload()
  uploadsBySha.set(sha256, upload)
  try {
    return await upload
  } catch (error: unknown) {
    if (uploadsBySha.get(sha256) === upload) {
      uploadsBySha.delete(sha256)
    }
    throw error
  }
}

export const buildManagedMediaFilename = (
  sourceUrl: string,
  extension: SupportedManagedImage["extension"]
): string => {
  const encodedSourceName = path.basename(new URL(sourceUrl).pathname)
  let sourceName = encodedSourceName.replace(/\+/g, " ")
  try {
    sourceName = decodeURIComponent(sourceName)
  } catch {
    // Keep the encoded path segment; sanitization below still makes it safe.
  }
  const parsed = path.parse(sourceName)
  const base =
    parsed.name
      .normalize("NFKD")
      .replace(/\p{M}+/gu, "")
      .replace(/[^\w-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "product-image"
  return `${base}${extension}`
}

export const isRetryableMediaStatus = (status: number): boolean =>
  status === 408 || status === 425 || status === 429 || status >= 500

export const parseRetryAfterMs = (
  value: string | null,
  nowMs = Date.now()
): number | null => {
  if (!value) {
    return null
  }
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, 60_000)
  }
  const dateMs = Date.parse(value)
  if (Number.isNaN(dateMs)) {
    return null
  }
  return Math.min(Math.max(dateMs - nowMs, 0), 60_000)
}

export const calculateMediaRetryDelayMs = (
  attempt: number,
  retryAfterMs: number | null,
  random = Math.random
): number => {
  const exponential = Math.min(1_000 * 2 ** Math.max(attempt, 0), 30_000)
  const jitter = Math.floor(random() * 500)
  return Math.max(exponential + jitter, retryAfterMs ?? 0)
}
