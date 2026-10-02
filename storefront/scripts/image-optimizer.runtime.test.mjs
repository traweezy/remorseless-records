import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { createRequire } from "node:module"
import { Readable } from "node:stream"
import test from "node:test"

const require = createRequire(import.meta.url)
const requireNext = createRequire(require.resolve("next/package.json"))
const sharp = requireNext("sharp")
const dns = require("node:dns/promises")
const http = require("node:http")
const https = require("node:https")
const {
  ImageError,
  fetchExternalImage,
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

test("pins remote image transport to validated DNS and rechecks before reuse", async (t) => {
  // No fixture host or external network is needed, including in the final
  // network-disabled runtime image. Any unguarded transport fails the test.
  t.mock.method(globalThis, "fetch", () => assert.fail("Unexpected fetch"))
  t.mock.method(https, "request", () => assert.fail("Unexpected HTTPS request"))
  const addresses = [
    { address: "93.184.216.34", family: 4 },
    { address: "2606:4700:4700::1111", family: 6 },
  ]
  const lookup = t.mock.method(dns, "lookup", async () => addresses)
  const body = Buffer.from("synthetic image response")
  let pinnedLookup
  const request = t.mock.method(http, "request", (url, options, respond) => {
    assert.equal(url.hostname, "images.invalid")
    assert.equal(typeof options.lookup, "function")
    pinnedLookup = options.lookup
    const outgoing = new EventEmitter()
    outgoing.end = () => {
      const response = Readable.from([body])
      response.statusCode = 200
      response.headers = { "content-type": "image/png" }
      queueMicrotask(() => respond(response))
    }
    return outgoing
  })

  const url = "http://images.invalid/synthetic.png"
  const result = await fetchExternalImage(url, false, 1024)
  assert.deepEqual(result.buffer, body)
  assert.equal(request.mock.callCount(), 1)
  assert.equal(lookup.mock.callCount(), 1)
  assert.equal(lookup.mock.calls[0].arguments[0], "images.invalid")
  assert.equal(lookup.mock.calls[0].arguments[1].all, true)

  lookup.mock.mockImplementation(async () => [
    { address: "127.0.0.1", family: 4 },
  ])
  const socketAddresses = await new Promise((resolve, reject) => {
    pinnedLookup("images.invalid", { all: true }, (error, resolved) => {
      if (error) reject(error)
      else resolve(resolved)
    })
  })
  assert.deepEqual(socketAddresses, addresses)
  assert.equal(lookup.mock.callCount(), 1)

  await assert.rejects(fetchExternalImage(url, false, 1024), (error) => {
    assert.ok(error instanceof ImageError)
    assert.equal(error.statusCode, 400)
    return true
  })
  assert.equal(lookup.mock.callCount(), 2)
  assert.equal(request.mock.callCount(), 1)
})

test("rejects remote images with any private DNS answer before transport", async (t) => {
  t.mock.method(globalThis, "fetch", () => assert.fail("Unexpected fetch"))
  const request = t.mock.method(http, "request", () =>
    assert.fail("Unexpected HTTP request")
  )
  const secureRequest = t.mock.method(https, "request", () =>
    assert.fail("Unexpected HTTPS request")
  )
  t.mock.method(dns, "lookup", async () => [
    { address: "93.184.216.34", family: 4 },
    { address: "::1", family: 6 },
  ])
  await assert.rejects(
    fetchExternalImage("https://images.invalid/synthetic.png", false, 1024),
    (error) => {
      assert.ok(error instanceof ImageError)
      assert.equal(error.statusCode, 400)
      return true
    }
  )
  assert.equal(request.mock.callCount(), 0)
  assert.equal(secureRequest.mock.callCount(), 0)
})
