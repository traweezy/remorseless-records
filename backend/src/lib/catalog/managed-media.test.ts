import {
  BIG_CARTEL_ASSET_HOST,
  MEDIA_CUTOVER_CONFIRMATION,
  MEDIA_STAGE_CONFIRMATION,
  buildManagedMediaFilename,
  calculateMediaRetryDelayMs,
  hashManagedMedia,
  inspectManagedImage,
  isBigCartelProductImageUrl,
  isRetryableMediaStatus,
  parseManagedMediaCommandOptions,
  parseRetryAfterMs,
  resolveDeduplicatedManagedUpload,
  selectBigCartelManagedMasterUrl,
} from "./managed-media"

const png = (width: number, height: number): Buffer => {
  const buffer = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(
    buffer
  )
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

const jpeg = (width: number, height: number): Buffer =>
  Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x00,
    0x03,
    0x11,
    0x00,
    0xff,
    0xd9,
  ])

describe("managed catalog media", () => {
  it("selects a stable 2000px Big Cartel master rendition", () => {
    expect(
      selectBigCartelManagedMasterUrl(
        `https://${BIG_CARTEL_ASSET_HOST}/product_images/123/Cover+Art.jpg?h=300&w=300#fragment`
      )
    ).toBe(
      `https://${BIG_CARTEL_ASSET_HOST}/product_images/123/Cover+Art.jpg?auto=format&fit=max&w=2000`
    )
  })

  it("rejects untrusted hosts, protocols, and paths", () => {
    expect(() =>
      selectBigCartelManagedMasterUrl(
        "https://evil.example/product_images/123/cover.jpg"
      )
    ).toThrow("Only HTTPS")
    expect(() =>
      selectBigCartelManagedMasterUrl(
        `http://${BIG_CARTEL_ASSET_HOST}/product_images/123/cover.jpg`
      )
    ).toThrow("Only HTTPS")
    expect(
      isBigCartelProductImageUrl(
        `https://${BIG_CARTEL_ASSET_HOST}/not-product-media/cover.jpg`
      )
    ).toBe(false)
  })

  it("validates PNG and JPEG bytes and dimensions", () => {
    expect(inspectManagedImage(png(1_200, 900), "image/png")).toEqual({
      extension: ".png",
      height: 900,
      mimeType: "image/png",
      width: 1_200,
    })
    expect(inspectManagedImage(jpeg(2_000, 1_500), "image/jpeg")).toEqual({
      extension: ".jpg",
      height: 1_500,
      mimeType: "image/jpeg",
      width: 2_000,
    })
  })

  it("rejects a declared type that does not match the file signature", () => {
    expect(() =>
      inspectManagedImage(png(100, 100), "image/jpeg; charset=binary")
    ).toThrow("does not match")
  })

  it("produces deterministic checksums and safe filenames", () => {
    expect(hashManagedMedia(Buffer.from("same bytes"))).toMatch(/^[0-9a-f]{64}$/)
    expect(
      buildManagedMediaFilename(
        `https://${BIG_CARTEL_ASSET_HOST}/product_images/123/Hëll+Cover!.jpeg?w=2000`,
        ".jpg"
      )
    ).toBe("hell-cover.jpg")
  })

  it("shares one in-flight upload for identical checksums", async () => {
    const uploads = new Map<string, Promise<{ id: string }>>()
    const createUpload = jest.fn(
      async (): Promise<{ id: string }> => ({ id: "file_1" })
    )

    await expect(
      Promise.all([
        resolveDeduplicatedManagedUpload(uploads, "a".repeat(64), createUpload),
        resolveDeduplicatedManagedUpload(uploads, "a".repeat(64), createUpload),
      ])
    ).resolves.toEqual([{ id: "file_1" }, { id: "file_1" }])
    expect(createUpload).toHaveBeenCalledTimes(1)
  })

  it("requires an exact destructive cutover confirmation", () => {
    expect(() =>
      parseManagedMediaCommandOptions(["--apply"])
    ).toThrow("requires --confirm-cutover")
    expect(
      parseManagedMediaCommandOptions([
        "--apply",
        `--confirm-cutover=${MEDIA_CUTOVER_CONFIRMATION}`,
      ])
    ).toMatchObject({
      apply: true,
      confirmation: MEDIA_CUTOVER_CONFIRMATION,
      maxAssets: null,
      minDelayMs: 1_000,
      stage: false,
    })
    expect(() =>
      parseManagedMediaCommandOptions([
        "--apply",
        `--confirm-cutover=${MEDIA_CUTOVER_CONFIRMATION}`,
        "--max-assets=1",
      ])
    ).toThrow("cannot be combined")
  })

  it("allows an explicitly confirmed, bounded staging run without cutover", () => {
    expect(
      parseManagedMediaCommandOptions([
        "--stage",
        `--confirm-stage=${MEDIA_STAGE_CONFIRMATION}`,
        "--max-assets=2",
      ])
    ).toMatchObject({
      apply: false,
      maxAssets: 2,
      stage: true,
      stageConfirmation: MEDIA_STAGE_CONFIRMATION,
    })
    expect(() =>
      parseManagedMediaCommandOptions(["--stage"])
    ).toThrow("requires --confirm-stage")
  })

  it("bounds Retry-After and exponential backoff", () => {
    expect(parseRetryAfterMs("2", 0)).toBe(2_000)
    expect(parseRetryAfterMs("120", 0)).toBe(60_000)
    expect(parseRetryAfterMs("not-a-date", 0)).toBeNull()
    expect(calculateMediaRetryDelayMs(2, null, () => 0)).toBe(4_000)
    expect(calculateMediaRetryDelayMs(0, 5_000, () => 0)).toBe(5_000)
    expect(isRetryableMediaStatus(429)).toBe(true)
    expect(isRetryableMediaStatus(503)).toBe(true)
    expect(isRetryableMediaStatus(404)).toBe(false)
  })
})
