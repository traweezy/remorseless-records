"use strict"

const fs = require("node:fs")
const path = require("node:path")
const sharp = require("sharp")

const compiledConstraintsPath = path.join(__dirname, "constraints.js")
const {
  IMAGE_PROCESSING_LIBVIPS_TIMEOUT_SECONDS,
  MANAGED_IMAGE_OUTPUT_MIME_TYPE,
  MAX_IMAGE_CHANNELS,
  MAX_IMAGE_DECOMPRESSED_BYTES,
  MAX_IMAGE_FRAMES,
  MAX_IMAGE_INPUT_DIMENSION,
  MAX_IMAGE_INPUT_PIXELS,
  MAX_IMAGE_OUTPUT_DIMENSION,
  MAX_NORMALIZED_IMAGE_BYTES,
  MAX_UPLOAD_BYTES,
} = require(
  fs.existsSync(compiledConstraintsPath)
    ? compiledConstraintsPath
    : path.join(__dirname, "constraints.ts"),
)

const MAX_STDIN_BYTES = Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 16_384
const MIME_BY_FORMAT = Object.freeze({
  gif: "image/gif",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
})

sharp.cache(false)
sharp.concurrency(1)

class ImageBoundaryError extends Error {
  constructor(code) {
    super(code)
    this.name = "ImageBoundaryError"
    this.code = code
  }
}

const rejectImage = (code) => {
  throw new ImageBoundaryError(code)
}

const positiveInteger = (value) =>
  Number.isSafeInteger(value) && value > 0 ? value : null

const inspectSource = async (buffer, declaredMimeType) => {
  let metadata
  try {
    metadata = await sharp(buffer, {
      failOn: "warning",
      limitInputChannels: MAX_IMAGE_CHANNELS,
      limitInputPixels: MAX_IMAGE_INPUT_PIXELS,
      pages: 1,
      sequentialRead: true,
    }).metadata()
  } catch {
    rejectImage("invalid_image")
  }

  const width = positiveInteger(metadata.width)
  const height = positiveInteger(metadata.height)
  const channels = positiveInteger(metadata.channels)
  const frames = positiveInteger(metadata.pages ?? 1)
  const bitsPerSample = positiveInteger(metadata.bitsPerSample ?? 8)
  const detectedMimeType = MIME_BY_FORMAT[metadata.format]
  if (
    !width ||
    !height ||
    !channels ||
    !frames ||
    !bitsPerSample ||
    !detectedMimeType ||
    detectedMimeType !== declaredMimeType
  ) {
    rejectImage("invalid_image")
  }
  if (
    width > MAX_IMAGE_INPUT_DIMENSION ||
    height > MAX_IMAGE_INPUT_DIMENSION ||
    width * height > MAX_IMAGE_INPUT_PIXELS ||
    channels > MAX_IMAGE_CHANNELS ||
    frames > MAX_IMAGE_FRAMES
  ) {
    rejectImage("image_limits_exceeded")
  }
  const decompressedBytes =
    width * height * channels * frames * Math.ceil(bitsPerSample / 8)
  if (
    !Number.isSafeInteger(decompressedBytes) ||
    decompressedBytes > MAX_IMAGE_DECOMPRESSED_BYTES
  ) {
    rejectImage("image_limits_exceeded")
  }

  return {
    channels,
    format: metadata.format,
    frames,
    height,
    width,
  }
}

const normalizeImage = async ({ content, declaredMimeType, sourceSize }) => {
  if (
    typeof content !== "string" ||
    !Number.isSafeInteger(sourceSize) ||
    sourceSize < 1 ||
    sourceSize > MAX_UPLOAD_BYTES
  ) {
    rejectImage("invalid_request")
  }
  const buffer = Buffer.from(content, "base64")
  if (buffer.length !== sourceSize) {
    rejectImage("invalid_request")
  }
  const source = await inspectSource(buffer, declaredMimeType)

  let normalized
  try {
    normalized = await sharp(buffer, {
      autoOrient: true,
      failOn: "warning",
      limitInputChannels: MAX_IMAGE_CHANNELS,
      limitInputPixels: MAX_IMAGE_INPUT_PIXELS,
      pages: 1,
      sequentialRead: true,
    })
      .resize({
        fit: "inside",
        height: MAX_IMAGE_OUTPUT_DIMENSION,
        width: MAX_IMAGE_OUTPUT_DIMENSION,
        withoutEnlargement: true,
      })
      .webp({
        alphaQuality: 90,
        effort: 4,
        quality: 90,
        smartSubsample: true,
      })
      .timeout({ seconds: IMAGE_PROCESSING_LIBVIPS_TIMEOUT_SECONDS })
      .toBuffer({ resolveWithObject: true })
  } catch {
    rejectImage("processing_failed")
  }
  if (
    !normalized.info ||
    normalized.info.format !== "webp" ||
    normalized.data.length < 1 ||
    normalized.data.length > MAX_NORMALIZED_IMAGE_BYTES
  ) {
    rejectImage("normalized_image_limits_exceeded")
  }

  let verification
  try {
    verification = await sharp(normalized.data, {
      failOn: "warning",
      limitInputChannels: MAX_IMAGE_CHANNELS,
      limitInputPixels: MAX_IMAGE_INPUT_PIXELS,
      pages: 1,
      sequentialRead: true,
    }).metadata()
  } catch {
    rejectImage("normalized_image_invalid")
  }
  if (
    verification.format !== "webp" ||
    verification.mediaType !== MANAGED_IMAGE_OUTPUT_MIME_TYPE ||
    !positiveInteger(verification.width) ||
    !positiveInteger(verification.height) ||
    verification.width > MAX_IMAGE_OUTPUT_DIMENSION ||
    verification.height > MAX_IMAGE_OUTPUT_DIMENSION ||
    (verification.pages ?? 1) !== 1 ||
    verification.exif ||
    verification.icc ||
    verification.iptc ||
    verification.xmp
  ) {
    rejectImage("normalized_image_invalid")
  }

  return {
    content: normalized.data.toString("base64"),
    height: verification.height,
    mimeType: MANAGED_IMAGE_OUTPUT_MIME_TYPE,
    size: normalized.data.length,
    source,
    width: verification.width,
  }
}

const writeResult = (value) => {
  process.stdout.write(JSON.stringify(value))
}

const chunks = []
let receivedBytes = 0
process.stdin.on("data", (chunk) => {
  receivedBytes += chunk.length
  if (receivedBytes > MAX_STDIN_BYTES) {
    writeResult({ code: "invalid_request", ok: false })
    process.exit(0)
  }
  chunks.push(chunk)
})
process.stdin.on("end", async () => {
  try {
    const request = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    writeResult({ ok: true, result: await normalizeImage(request) })
  } catch (error) {
    writeResult({
      code:
        error instanceof ImageBoundaryError
          ? error.code
          : "invalid_request",
      ok: false,
    })
  }
})
