import { faker } from "@faker-js/faker"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("getFullCatalogHits", () => {
  beforeEach(() => {
    faker.seed(2601)
  })

  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it("maps catalog products into search hits across pages", async () => {
    const validHandle = faker.helpers.slugify(faker.music.songName()).toLowerCase()
    const regionId = faker.string.uuid()
    const mappedHit = {
      id: faker.string.uuid(),
      handle: validHandle,
    }
    const firstProductId = faker.string.uuid()
    const secondProductId = faker.string.uuid()

    const list = vi.fn().mockResolvedValueOnce({
      products: [
        { id: firstProductId, handle: validHandle },
        { id: secondProductId, handle: "" },
      ],
    })
    const mapStoreProductToSearchHit = vi.fn().mockReturnValue(mappedHit)

    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/lib/medusa", () => ({
      storeClient: {
        product: { list },
      },
    }))
    vi.doMock("@/lib/regions", () => ({
      resolveRegionId: vi.fn().mockResolvedValue(regionId),
    }))
    vi.doMock("@/lib/data/products", () => ({
      getAllProductHandles: vi.fn().mockResolvedValue([
        { handle: validHandle, id: firstProductId, updatedAt: null },
        { handle: "missing", id: secondProductId, updatedAt: null },
      ]),
      PRODUCT_LIST_FIELDS: "id,handle",
    }))
    vi.doMock("@/lib/products/transformers", () => ({
      mapStoreProductToSearchHit,
    }))

    const { getFullCatalogHits } = await import("@/lib/catalog/all")
    const hits = await getFullCatalogHits()

    expect(hits).toEqual([mappedHit])
    expect(mapStoreProductToSearchHit).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalled()
  })

  it("returns empty hits when loading catalog fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/lib/medusa", () => ({
      storeClient: {
        product: { list: vi.fn().mockRejectedValue(new Error("boom")) },
      },
    }))
    vi.doMock("@/lib/regions", () => ({
      resolveRegionId: vi.fn().mockResolvedValue("region_us"),
    }))
    vi.doMock("@/lib/data/products", () => ({
      getAllProductHandles: vi
        .fn()
        .mockRejectedValue(new Error("handle feed failed")),
      PRODUCT_LIST_FIELDS: "id,handle",
    }))
    vi.doMock("@/lib/products/transformers", () => ({
      mapStoreProductToSearchHit: vi.fn(),
    }))

    const { getFullCatalogHits } = await import("@/lib/catalog/all")
    await expect(getFullCatalogHits()).resolves.toEqual([])
    expect(errorSpy).toHaveBeenCalled()
  })

  it("continues through full batches and stops on a short page", async () => {
    const regionId = faker.string.uuid()
    const firstBatch = Array.from({ length: 100 }, () => ({
      id: faker.string.uuid(),
      handle: faker.helpers.slugify(faker.music.songName()).toLowerCase(),
    }))
    const firstHandleRecords = firstBatch.map((product) => ({
      handle: product.handle,
      id: product.id,
      updatedAt: null,
    }))
    const secondProductId = faker.string.uuid()
    const secondHandle = faker.helpers.slugify(faker.music.songName()).toLowerCase()

    const list = vi
      .fn()
      .mockResolvedValueOnce({
        products: firstBatch,
      })
      .mockResolvedValueOnce({
        products: [{ id: secondProductId, handle: secondHandle }],
      })
    const mapStoreProductToSearchHit = vi
      .fn()
      .mockImplementation((product: { id: string; handle: string }) => ({
        id: product.id,
        handle: product.handle,
      }))

    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/lib/medusa", () => ({
      storeClient: {
        product: { list },
      },
    }))
    vi.doMock("@/lib/regions", () => ({
      resolveRegionId: vi.fn().mockResolvedValue(regionId),
    }))
    vi.doMock("@/lib/data/products", () => ({
      getAllProductHandles: vi.fn().mockResolvedValue([
        ...firstHandleRecords,
        { handle: secondHandle, id: secondProductId, updatedAt: null },
      ]),
      PRODUCT_LIST_FIELDS: "id,handle",
    }))
    vi.doMock("@/lib/products/transformers", () => ({
      mapStoreProductToSearchHit,
    }))

    const { getFullCatalogHits } = await import("@/lib/catalog/all")
    const hits = await getFullCatalogHits()

    expect(hits).toHaveLength(101)
    expect(list).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: firstBatch.map((product) => product.id),
        region_id: regionId,
      })
    )
    expect(list).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: [secondProductId],
        region_id: regionId,
      })
    )
  })
})
