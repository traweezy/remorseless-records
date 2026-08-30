import { uploadCatalogCreationMedia } from "./catalog-creation-media-query"

const image = (): File =>
  new File([new Uint8Array([0xff, 0xd8, 0xff])], "cover.jpg", {
    type: "image/jpeg",
  })

describe("catalog creation media upload query", () => {
  it("uses the managed multipart endpoint and validates its response", async () => {
    const fetcher = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          files: [
            {
              filename: "cover.jpg",
              id: "file_1",
              mediaAssetId: "media_asset_1",
              mimeType: "image/webp",
              size: 72,
              url: "https://cdn.example.com/cover.webp",
            },
          ],
        }),
        { status: 201 },
      ),
    )

    await expect(
      uploadCatalogCreationMedia([image()], { fetcher }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "file_1",
        mediaAssetId: "media_asset_1",
      }),
    ])
    expect(fetcher).toHaveBeenCalledWith(
      "/admin/catalog/media/uploads",
      expect.objectContaining({
        body: expect.any(FormData),
        credentials: "include",
        method: "POST",
        signal: expect.any(AbortSignal),
      }),
    )
    const request = fetcher.mock.calls[0]?.[1] as RequestInit
    const body = request.body as FormData
    expect(body.getAll("files")).toHaveLength(1)
    expect(body.get("idempotencyKey")).toEqual(expect.any(String))
  })

  it("surfaces safe server errors and rejects malformed success payloads", async () => {
    const failedFetcher = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Upload quota reached." }), {
        status: 429,
      }),
    )
    await expect(
      uploadCatalogCreationMedia([image()], { fetcher: failedFetcher }),
    ).rejects.toThrow("Upload quota reached.")

    const invalidFetcher = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ files: [{ id: "file_1" }] }), {
        status: 201,
      }),
    )
    await expect(
      uploadCatalogCreationMedia([image()], { fetcher: invalidFetcher }),
    ).rejects.toThrow("invalid image upload response")
  })
})
