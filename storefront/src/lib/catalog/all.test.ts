import { faker } from "@faker-js/faker"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/products/presentation.server", () => ({
  presentStoreProducts: vi.fn(async (products: unknown[]) => products),
}))

describe("getFullCatalogHits", () => {
  beforeEach(() => {
    faker.seed(2601)
  })

  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it("maps catalog products into search hits across pages", async () => {
    const validHandle = faker.helpers
      .slugify(faker.music.songName())
      .toLowerCase()
    const regionId = faker.string.uuid()
    const mappedHit = {
      id: faker.string.uuid(),
      handle: validHandle,
    }
    const firstProductId = faker.string.uuid()
    const secondProductId = faker.string.uuid()

    const list = vi.fn().mockResolvedValueOnce({
      products: [{ id: firstProductId, handle: validHandle }],
    })
    const mapStoreProductToSearchHit = vi.fn().mockReturnValue(mappedHit)

    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/lib/medusa/read-client", () => ({
      fetchMedusaStoreRead: list,
    }))
    vi.doMock("@/lib/regions", () => ({
      resolveRegionId: vi.fn().mockResolvedValue(regionId),
    }))
    vi.doMock("@/lib/data/products", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/data/products")>()),
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
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined)
    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/lib/medusa/read-client", () => ({
      fetchMedusaStoreRead: vi.fn().mockRejectedValue(new Error("boom")),
    }))
    vi.doMock("@/lib/regions", () => ({
      resolveRegionId: vi.fn().mockResolvedValue("region_us"),
    }))
    vi.doMock("@/lib/data/products", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/data/products")>()),
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
    const firstBatch = Array.from({ length: 100 }, (_, index) => ({
      id: faker.string.uuid(),
      handle: `${faker.helpers
        .slugify(faker.music.songName())
        .toLowerCase()}-${index}`,
    }))
    const firstHandleRecords = firstBatch.map((product) => ({
      handle: product.handle,
      id: product.id,
      updatedAt: null,
    }))
    const secondProductId = faker.string.uuid()
    const secondHandle = faker.helpers
      .slugify(faker.music.songName())
      .toLowerCase()

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
    vi.doMock("@/lib/medusa/read-client", () => ({
      fetchMedusaStoreRead: list,
    }))
    vi.doMock("@/lib/regions", () => ({
      resolveRegionId: vi.fn().mockResolvedValue(regionId),
    }))
    vi.doMock("@/lib/data/products", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/data/products")>()),
      getAllProductHandles: vi
        .fn()
        .mockResolvedValue([
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
    const [firstPath, firstInit] = list.mock.calls[0] as [
      string,
      { query?: Record<string, unknown> },
    ]
    const [secondPath, secondInit] = list.mock.calls[1] as [
      string,
      { query?: Record<string, unknown> },
    ]
    expect(firstPath).toBe("/store/products")
    expect(firstInit.query).toMatchObject({
      id: firstBatch.map((product) => product.id),
      region_id: regionId,
    })
    expect(secondPath).toBe("/store/products")
    expect(secondInit.query).toMatchObject({
      id: [secondProductId],
      region_id: regionId,
    })
  })

  it("refreshes old mapped caches and counts bundles through the real full-catalog mapper", async () => {
    const products = Array.from({ length: 101 }, (_, index) => ({
      id: `prod_${index}`,
      handle: `catalog-product-${index}`,
      title:
        index === 100
          ? "Concrete Winds - Discography Bundle"
          : `Release ${index}`,
      options: [
        {
          title: "Format",
          values:
            index === 100
              ? [{ value: "3CD Bundle" }, { value: "3LP Bundle" }]
              : [{ value: "CD" }],
        },
      ],
      variants:
        index === 100
          ? [
              { id: "variant_bundle_cd", title: "3CD Bundle" },
              { id: "variant_bundle_lp", title: "3LP Bundle" },
            ]
          : [{ id: `variant_${index}`, title: "CD" }],
    }))
    const cache = new Map<string, unknown>([
      ["full-catalog-hits-v4", []],
      ["catalog-format-options-v2", [{ value: "CD", label: "CD", count: 100 }]],
    ])
    vi.doMock("next/cache", () => ({
      unstable_cache:
        (callback: () => Promise<unknown>, key: string[]) => async () => {
          const name = key.join(":")
          if (!cache.has(name)) cache.set(name, await callback())
          return cache.get(name)
        },
    }))
    const list = vi.fn().mockImplementation(async (_path, init) => ({
      products: products.filter((product) =>
        init.query.id.includes(product.id)
      ),
    }))
    vi.doMock("@/lib/medusa/read-client", () => ({
      fetchMedusaStoreRead: list,
    }))
    vi.doMock("@/lib/regions", () => ({
      resolveRegionId: vi.fn().mockResolvedValue("region_us"),
    }))
    vi.doMock("@/lib/data/products", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/data/products")>()),
      getAllProductHandles: vi.fn().mockResolvedValue(
        products.map((product) => ({
          id: product.id,
          handle: product.handle,
          updatedAt: null,
        }))
      ),
      PRODUCT_LIST_FIELDS: "id,handle,title,*variants,*options",
    }))
    vi.doMock("@/lib/data/categories", () => ({
      getMetalGenreCategories: vi.fn(),
    }))
    vi.doMock("@/lib/search/server", () => ({ searchProductsServer: vi.fn() }))
    vi.doUnmock("@/lib/products/transformers")
    vi.doUnmock("@/lib/catalog/all")

    const { getFullCatalogHits } = await import("@/lib/catalog/all")
    const { getCatalogFormatOptions } = await import(
      "@/lib/catalog/filters.server"
    )
    expect(await getFullCatalogHits()).toHaveLength(101)
    const expected = [
      { value: "Vinyl", label: "Vinyl", count: 1 },
      { value: "CD", label: "CD", count: 101 },
    ]
    await expect(getCatalogFormatOptions()).resolves.toEqual(expected)
    await expect(getCatalogFormatOptions()).resolves.toEqual(expected)
    expect(list).toHaveBeenCalledTimes(2)
    expect(list.mock.calls[0]?.[1].query.id).toHaveLength(100)
    expect(list.mock.calls[1]?.[1].query.id).toEqual(["prod_100"])
  })
})
