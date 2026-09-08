import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(import.meta.url)
const requireNext = createRequire(require.resolve("next/package.json"))
const sharp = requireNext("sharp")
const {
  ImageError,
  getImageEtag,
  imageOptimizer,
} = require("next/dist/server/image-optimizer.js")

// Run this file through test:runtime:images, in its own Node test process.
// Next configures Sharp's global loader permissions; sharing a Vitest process
// would make decoder acceptance depend on unrelated tests and import order.
const nextConfig = Object.freeze({
  images: Object.freeze({
    minimumCacheTTL: 60,
    dangerouslyAllowSVG: false,
  }),
  experimental: Object.freeze({
    imgOptConcurrency: 1,
    imgOptOperationCache: false,
    imgOptMaxInputPixels: 4096,
    imgOptSequentialRead: true,
    imgOptTimeoutInSeconds: 3,
  }),
})

const createImage = () =>
  sharp({
    create: {
      width: 64,
      height: 48,
      channels: 3,
      background: { r: 42, g: 80, b: 160 },
    },
  }).timeout({ seconds: 3 })

const optimize = (buffer, mimeType = "image/webp") =>
  imageOptimizer(
    {
      buffer,
      etag: getImageEtag(buffer),
      contentType: null,
      cacheControl: "public, max-age=60",
    },
    {
      // This is an in-memory identity, never fetched or served as an asset.
      href: "/synthetic-in-memory-image",
      width: 32,
      quality: 75,
      mimeType,
    },
    nextConfig,
    { isDev: false, silent: true }
  )

const assertOptimized = async (result, source, contentType) => {
  // A successful call alone is insufficient: Next can return upstream bytes
  // with an error field instead of throwing when native decoding fails.
  assert.equal(Object.hasOwn(result, "error"), false)
  assert.equal(result.contentType, contentType)
  assert.equal(result.buffer.equals(source), false)
  assert.notEqual(result.etag, getImageEtag(source))
  assert.equal(result.etag, getImageEtag(result.buffer))
  assert.equal(result.upstreamEtag, getImageEtag(source))
  assert.equal(result.maxAge, 60)
  const metadata = await sharp(result.buffer).timeout({ seconds: 3 }).metadata()
  assert.deepEqual([metadata.width, metadata.height], [32, 24])
  const { data, info } = await sharp(result.buffer)
    .timeout({ seconds: 3 })
    .raw()
    .toBuffer({ resolveWithObject: true })
  assert.deepEqual([info.width, info.height, info.channels], [32, 24, 3])
  assert.equal(data.byteLength, 32 * 24 * 3)
  return metadata
}

test("decodes AVIF input and resizes it to WebP without bypass or fallback", async (t) => {
  t.diagnostic(
    JSON.stringify({
      next: require("next/package.json").version,
      sharp: sharp.versions.sharp,
      heif: sharp.versions.heif,
      vips: sharp.versions.vips,
    })
  )
  const source = await createImage().avif({ quality: 50, effort: 0 }).toBuffer()
  const sourceMetadata = await sharp(source).timeout({ seconds: 3 }).metadata()
  assert.equal(sourceMetadata.format, "heif")
  assert.equal(sourceMetadata.compression, "av1")
  assert.deepEqual([sourceMetadata.width, sourceMetadata.height], [64, 48])

  const result = await optimize(source)
  const metadata = await assertOptimized(result, source, "image/webp")
  assert.equal(metadata.format, "webp")
})

test("resizes PNG input to AVIF that remains fully decodable", async () => {
  const source = await createImage().png().toBuffer()
  const result = await optimize(source, "image/avif")
  const metadata = await assertOptimized(result, source, "image/avif")
  assert.equal(metadata.format, "heif")
  assert.equal(metadata.compression, "av1")
})

test("rejects non-image input with the optimizer's 400 error", async () => {
  await assert.rejects(optimize(Buffer.from("not an image")), (error) => {
    assert.ok(error instanceof ImageError)
    assert.equal(error.statusCode, 400)
    return true
  })
})

test("retains default-deny behavior for SVG input", async () => {
  const source = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"/>'
  )
  await assert.rejects(optimize(source), (error) => {
    assert.ok(error instanceof ImageError)
    assert.equal(error.statusCode, 400)
    return true
  })
})

test("classifies a truncated PNG as fallback, not successful optimization", async () => {
  const png = await createImage().png().toBuffer()
  // Retain only the signature of our generated benign image, not its data.
  const source = png.subarray(0, 8)
  const result = await optimize(source)
  assert.ok(result.error instanceof Error)
  assert.equal(result.contentType, "image/png")
  assert.equal(result.buffer, source)
  assert.equal(result.etag, getImageEtag(source))
  assert.equal(result.upstreamEtag, getImageEtag(source))
  assert.equal(result.maxAge, 60)
})
