import { uploadNewsCover, validateNewsCover } from "./news-media-query"

const imageFile = (
  type = "image/png",
  size = 4,
): File => new File([new Uint8Array(size)], "cover.png", { type })

describe("News cover upload", () => {
  it("rejects unsupported and empty images before networking", () => {
    expect(validateNewsCover(imageFile("text/plain"))).toMatch("JPEG")
    expect(validateNewsCover(imageFile("image/png", 0))).toMatch("empty")
  })

  it("returns the validated managed URL", async () => {
    const fetcher = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ files: [{ url: "https://cdn.example.com/cover.png" }] }),
      ok: true,
    })

    await expect(
      uploadNewsCover(imageFile(), { fetcher }),
    ).resolves.toBe("https://cdn.example.com/cover.png")
    expect(fetcher).toHaveBeenCalledWith(
      "/admin/managed-uploads",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
      }),
    )
  })

  it("rejects malformed successful responses", async () => {
    const fetcher = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ files: [] }),
      ok: true,
    })

    await expect(uploadNewsCover(imageFile(), { fetcher })).rejects.toThrow(
      "invalid cover upload response",
    )
  })

  it("rejects managed URLs with a non-web scheme", async () => {
    const fetcher = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ files: [{ url: "ftp://cdn.example.com/cover.png" }] }),
      ok: true,
    })

    await expect(uploadNewsCover(imageFile(), { fetcher })).rejects.toThrow(
      "invalid cover upload response",
    )
  })
})
