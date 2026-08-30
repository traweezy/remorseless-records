import { createHash } from "node:crypto"

import { MedusaError } from "@medusajs/framework/utils"
import sharp from "sharp"

import {
  buildImageSandboxCommand,
  normalizeManagedImageUpload,
} from "./image-normalization"

const upload = ({
  buffer,
  filename = "Album Cover.png",
  mimeType = "image/png",
}: {
  buffer: Buffer
  filename?: string
  mimeType?: string
}): Express.Multer.File =>
  ({
    buffer,
    destination: "",
    encoding: "7bit",
    fieldname: "files",
    filename: "",
    mimetype: mimeType,
    originalname: filename,
    path: "",
    size: buffer.length,
    stream: null as never,
  }) satisfies Express.Multer.File

describe("managed image normalization", () => {
  it("re-encodes a metadata-bearing image as a bounded metadata-free WebP", async () => {
    const source = await sharp({
      create: {
        background: { alpha: 1, b: 80, g: 40, r: 20 },
        channels: 4,
        height: 24,
        width: 48,
      },
    })
      .png()
      .withMetadata({ orientation: 6 })
      .toBuffer()

    const result = await normalizeManagedImageUpload(upload({ buffer: source }))
    const metadata = await sharp(result.buffer).metadata()

    expect(result).toMatchObject({
      filename: "Album-Cover.webp",
      height: 48,
      mimeType: "image/webp",
      sha256: createHash("sha256").update(result.buffer).digest("hex"),
      size: result.buffer.length,
      source: {
        channels: 4,
        filename: "Album Cover.png",
        format: "png",
        frames: 1,
        height: 24,
        mimeType: "image/png",
        sha256: createHash("sha256").update(source).digest("hex"),
        size: source.length,
        width: 48,
      },
      width: 24,
    })
    expect(metadata).toMatchObject({
      format: "webp",
      height: 48,
      width: 24,
    })
    expect(metadata.exif).toBeUndefined()
    expect(metadata.icc).toBeUndefined()
    expect(metadata.iptc).toBeUndefined()
    expect(metadata.xmp).toBeUndefined()
  })

  it("rejects a header-valid payload that cannot be decoded", async () => {
    const corruptPng = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ])

    await expect(
      normalizeManagedImageUpload(upload({ buffer: corruptPng })),
    ).rejects.toMatchObject<Partial<MedusaError>>({
      message: "The image could not be decoded and normalized safely.",
      type: MedusaError.Types.INVALID_DATA,
    })
  })

  it("rejects a declared media type that differs from decoded content", async () => {
    const source = await sharp({
      create: {
        background: { b: 3, g: 2, r: 1 },
        channels: 3,
        height: 8,
        width: 8,
      },
    })
      .png()
      .toBuffer()

    await expect(
      normalizeManagedImageUpload(
        upload({ buffer: source, filename: "cover.jpg", mimeType: "image/jpeg" }),
      ),
    ).rejects.toThrow("could not be decoded and normalized safely")
  })

  it("rejects animated inputs instead of silently publishing one frame", async () => {
    const width = 4
    const height = 4
    const channels = 3
    const frameBytes = width * height * channels
    const source = await sharp(
      Buffer.concat([
        Buffer.alloc(frameBytes, 0),
        Buffer.alloc(frameBytes, 255),
      ]),
      {
        raw: {
          channels,
          height: height * 2,
          pageHeight: height,
          width,
        },
      },
    )
      .gif({ delay: [100, 100], loop: 0 })
      .toBuffer()

    await expect(
      normalizeManagedImageUpload(
        upload({ buffer: source, filename: "animated.gif", mimeType: "image/gif" }),
      ),
    ).rejects.toThrow("exceeds the safe dimension, pixel, frame")
  })

  it("rejects a decoded dimension beyond the explicit image boundary", async () => {
    const source = await sharp({
      create: {
        background: { b: 3, g: 2, r: 1 },
        channels: 3,
        height: 1,
        width: 12_001,
      },
    })
      .png()
      .toBuffer()

    await expect(
      normalizeManagedImageUpload(upload({ buffer: source })),
    ).rejects.toThrow("exceeds the safe dimension, pixel, frame")
  })

  it("starts a resource-limited worker without ambient privileges or secrets", () => {
    const command = buildImageSandboxCommand()
    const argumentText = command.args.join(" ")

    expect(command.command).toBe("/usr/bin/prlimit")
    expect(argumentText).toContain("--as=2147483648:2147483648")
    expect(argumentText).toContain("--cpu=10:10")
    expect(argumentText).toContain("--nofile=64:64")
    expect(argumentText).toContain("--permission")
    expect(argumentText).toContain("--allow-addons")
    expect(argumentText).not.toContain("--allow-net")
    expect(argumentText).not.toContain("--allow-fs-write")
    expect(argumentText).not.toContain("--allow-child-process")
    expect(argumentText).not.toContain("--allow-worker")
    expect(command.env).toEqual({
      MALLOC_ARENA_MAX: "2",
      NODE_ENV: "production",
      SHARP_IGNORE_GLOBAL_LIBVIPS: "1",
      TMPDIR: "/nonexistent",
      UV_THREADPOOL_SIZE: "1",
      VIPS_BLOCK_UNTRUSTED: "1",
      VIPS_CONCURRENCY: "1",
    })
  })
})
