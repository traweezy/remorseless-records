import { requestAdminJson } from "../../lib/admin-request"
import {
  MEDIA_CLEANUP_PAGE_SIZE,
  MEDIA_CLEANUP_QUERY_KEY,
  emptyMediaPage,
  mediaAssetSchema,
  mediaCleanupQueryOptions,
  orphanMediaPageSchema,
  updateMediaLifecycle,
} from "./query"

jest.mock("../../lib/admin-request", () => ({
  requestAdminJson: jest.fn(),
}))

const asset = {
  byteSize: 24_000,
  createdAt: "2026-08-08T12:00:00.000Z",
  id: "asset/01",
  lifecycleStatus: "active",
  mimeType: "image/webp",
  originalFilename: "cover.webp",
  purgeEligibleAt: null,
  quarantinedAt: null,
  quarantinedBy: null,
  sourceFileKey: "catalog/cover.webp",
  sourceUrl: "https://assets.example.test/catalog/cover.webp",
  version: 2,
} as const

describe("media cleanup query", () => {
  beforeEach(() => {
    jest.mocked(requestAdminJson).mockReset()
  })

  it("validates the lifecycle and page response contracts", () => {
    expect(mediaAssetSchema.parse(asset)).toEqual(asset)
    expect(
      orphanMediaPageSchema.parse({
        assets: [asset],
        count: 1,
        hasMore: false,
        limit: MEDIA_CLEANUP_PAGE_SIZE,
        offset: 0,
      })
    ).toMatchObject({ assets: [asset], count: 1 })
    expect(() => mediaAssetSchema.parse({ ...asset, version: 0 })).toThrow()
    expect(emptyMediaPage(50)).toMatchObject({ assets: [], offset: 50 })
  })

  it("forwards lifecycle filters and Query cancellation", async () => {
    const response = {
      assets: [asset],
      count: 1,
      hasMore: false,
      limit: MEDIA_CLEANUP_PAGE_SIZE,
      offset: 25,
    }
    jest.mocked(requestAdminJson).mockResolvedValue(response)
    const options = mediaCleanupQueryOptions({
      lifecycleStatus: "active",
      offset: 25,
    })
    const controller = new AbortController()

    await expect(
      options.queryFn?.({
        meta: undefined,
        queryKey: options.queryKey,
        signal: controller.signal,
      })
    ).resolves.toEqual(response)

    expect(options.queryKey).toEqual([
      ...MEDIA_CLEANUP_QUERY_KEY,
      "active",
      MEDIA_CLEANUP_PAGE_SIZE,
      25,
    ])
    expect(requestAdminJson).toHaveBeenCalledWith({
      path: "/admin/catalog/media/orphans",
      query: {
        lifecycleStatus: "active",
        limit: MEDIA_CLEANUP_PAGE_SIZE,
        offset: 25,
      },
      schema: orphanMediaPageSchema,
      signal: controller.signal,
    })
  })

  it("uses optimistic version and caller-owned idempotency for lifecycle writes", async () => {
    jest.mocked(requestAdminJson).mockResolvedValue({ asset })

    await expect(
      updateMediaLifecycle({ asset, idempotencyKey: "idem-01" })
    ).resolves.toBe("quarantine")

    expect(requestAdminJson).toHaveBeenCalledWith({
      body: { expectedVersion: 2, idempotencyKey: "idem-01" },
      method: "POST",
      path: "/admin/catalog/media/assets/asset%2F01/quarantine",
      schema: expect.anything(),
    })
  })
})
