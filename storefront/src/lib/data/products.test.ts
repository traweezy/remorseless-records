import { faker } from "@faker-js/faker"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("products data layer", () => {
  beforeEach(() => {
    faker.seed(1901)
  })

  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it("loads homepage products and product by handle", async () => {
    const firstId = faker.string.uuid()
    const firstHandle = faker.helpers.slugify(faker.music.songName()).toLowerCase()
    const secondId = faker.string.uuid()
    const secondHandle = faker.helpers.slugify(faker.music.songName()).toLowerCase()
    const regionId = faker.string.uuid()

    const list = vi
      .fn()
      .mockResolvedValueOnce({
        products: [{ id: firstId, handle: firstHandle, title: faker.music.songName() }],
      })
      .mockResolvedValueOnce({
        products: [{ id: secondId, handle: secondHandle, title: faker.music.songName() }],
      })

    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/lib/medusa", () => ({
      storeClient: {
        product: { list },
        collection: { list: vi.fn() },
      },
    }))
    vi.doMock("@/lib/regions", () => ({
      resolveRegionId: vi.fn().mockResolvedValue(regionId),
    }))

    const { getHomepageProducts, getProductByHandle } = await import("@/lib/data/products")
    await expect(getHomepageProducts()).resolves.toEqual([
      expect.objectContaining({ id: firstId, handle: firstHandle }),
    ])
    await expect(getProductByHandle(secondHandle)).resolves.toEqual(
      expect.objectContaining({
        id: secondId,
        handle: secondHandle,
      })
    )
  })

  it("loads collection products across pages and filters empty handles", async () => {
    const validFirst = faker.helpers.slugify(faker.music.songName()).toLowerCase()
    const validSecond = faker.helpers.slugify(faker.music.songName()).toLowerCase()
    const regionId = faker.string.uuid()
    const collectionId = faker.string.uuid()
    const collectionHandle = faker.helpers.slugify(faker.word.words(2)).toLowerCase()

    const productList = vi
      .fn()
      .mockResolvedValueOnce({
        products: [
          { id: faker.string.uuid(), handle: validFirst },
          { id: faker.string.uuid(), handle: "" },
        ],
      })
      .mockResolvedValueOnce({
        products: [{ id: faker.string.uuid(), handle: validSecond }],
      })
      .mockResolvedValueOnce({
        products: [],
      })
    const collectionList = vi.fn().mockResolvedValue({
      collections: [{ id: collectionId, handle: collectionHandle }],
    })

    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/lib/medusa", () => ({
      storeClient: {
        product: { list: productList },
        collection: { list: collectionList },
      },
    }))
    vi.doMock("@/lib/regions", () => ({
      resolveRegionId: vi.fn().mockResolvedValue(regionId),
    }))

    const { getCollectionProductsByHandle } = await import("@/lib/data/products")
    const products = await getCollectionProductsByHandle(collectionHandle, 2)
    expect(products.map((product) => product.handle)).toEqual([validFirst, validSecond])
  })

  it("collects all product handles with slug and updatedAt fallback", async () => {
    const regionId = faker.string.uuid()
    const updatedAt = faker.date.recent().toISOString()
    const handle = faker.helpers.slugify(faker.music.songName()).toLowerCase()
    const title = `${faker.person.lastName()} - ${faker.music.songName()}`

    const list = vi
      .fn()
      .mockResolvedValueOnce({
        products: [
          {
            id: faker.string.uuid(),
            handle,
            title,
            updated_at: updatedAt,
          },
        ],
      })
      .mockResolvedValueOnce({ products: [] })

    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/lib/medusa", () => ({
      storeClient: {
        product: { list },
        collection: { list: vi.fn() },
      },
    }))
    vi.doMock("@/lib/regions", () => ({
      resolveRegionId: vi.fn().mockResolvedValue(regionId),
    }))

    const { getAllProductHandles } = await import("@/lib/data/products")
    const handles = await getAllProductHandles()

    expect(handles).toHaveLength(1)
    expect(handles[0]).toMatchObject({
      handle,
      updatedAt,
    })
    expect(handles[0]?.slug.artistSlug.length).toBeGreaterThan(0)
  })

  it("returns empty collection products when collection handle is unknown", async () => {
    const collectionHandle = faker.helpers.slugify(faker.word.words(2)).toLowerCase()

    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/lib/medusa", () => ({
      storeClient: {
        product: { list: vi.fn() },
        collection: { list: vi.fn().mockResolvedValue({ collections: [] }) },
      },
    }))
    vi.doMock("@/lib/regions", () => ({
      resolveRegionId: vi.fn().mockResolvedValue(faker.string.uuid()),
    }))

    const { getCollectionProductsByHandle } = await import("@/lib/data/products")
    await expect(getCollectionProductsByHandle(collectionHandle)).resolves.toEqual([])
  })

  it("falls back safely when list payload is malformed", async () => {
    const regionId = faker.string.uuid()
    const handle = faker.helpers.slugify(faker.music.songName()).toLowerCase()

    const list = vi
      .fn()
      .mockResolvedValueOnce({ products: null })
      .mockResolvedValueOnce({ products: [{ id: faker.string.uuid(), handle }] })
      .mockResolvedValueOnce({ products: "not-an-array" })

    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/lib/medusa", () => ({
      storeClient: {
        product: { list },
        collection: { list: vi.fn() },
      },
    }))
    vi.doMock("@/lib/regions", () => ({
      resolveRegionId: vi.fn().mockResolvedValue(regionId),
    }))

    const { getHomepageProducts, getProductByHandle, getProductsByCollection } = await import(
      "@/lib/data/products"
    )
    await expect(getHomepageProducts()).resolves.toEqual([])
    await expect(getProductByHandle(handle)).resolves.toMatchObject({ handle })
    await expect(getProductsByCollection(faker.string.uuid())).resolves.toEqual([])
  })

  it("returns null/empty values when product loaders throw", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const list = vi.fn().mockRejectedValue(new Error("boom"))
    const collectionList = vi.fn().mockRejectedValue(new Error("boom"))

    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/lib/medusa", () => ({
      storeClient: {
        product: { list },
        collection: { list: collectionList },
      },
    }))
    vi.doMock("@/lib/regions", () => ({
      resolveRegionId: vi.fn().mockResolvedValue(faker.string.uuid()),
    }))

    const {
      getProductByHandle,
      getProductsByCollection,
      getRecentProducts,
      getCollectionProductsByHandle,
      getAllProductHandles,
    } = await import("@/lib/data/products")

    await expect(getProductByHandle(faker.helpers.slugify(faker.music.songName()))).resolves.toBeNull()
    await expect(getProductsByCollection(faker.string.uuid(), faker.number.int({ min: 1, max: 12 }))).resolves.toEqual([])
    await expect(getRecentProducts(faker.number.int({ min: 1, max: 12 }))).resolves.toEqual([])
    await expect(
      getCollectionProductsByHandle(faker.helpers.slugify(faker.word.words(2)))
    ).resolves.toEqual([])
    await expect(getAllProductHandles()).resolves.toEqual([])
    expect(errorSpy).toHaveBeenCalled()
  })

  it("uses createdAt fallback and skips products with missing handles", async () => {
    const regionId = faker.string.uuid()
    const pageSize = 100
    const firstHandle = faker.helpers.slugify(faker.music.songName()).toLowerCase()
    const createdAt = faker.date.past().toISOString()
    const paddedBatch = Array.from({ length: pageSize - 2 }, () => ({
      id: faker.string.uuid(),
      handle: faker.helpers.slugify(faker.music.songName()).toLowerCase(),
      title: `${faker.person.lastName()} - ${faker.music.songName()}`,
      createdAt,
    }))

    const list = vi
      .fn()
      .mockResolvedValueOnce({
        products: [
          {
            id: faker.string.uuid(),
            handle: firstHandle,
            title: `${faker.person.lastName()} - ${faker.music.songName()}`,
            createdAt,
          },
          { id: faker.string.uuid(), handle: "", title: faker.music.songName() },
          ...paddedBatch,
        ],
      })
      .mockResolvedValueOnce({ products: [] })

    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/lib/medusa", () => ({
      storeClient: {
        product: { list },
        collection: { list: vi.fn() },
      },
    }))
    vi.doMock("@/lib/regions", () => ({
      resolveRegionId: vi.fn().mockResolvedValue(regionId),
    }))

    const { getAllProductHandles } = await import("@/lib/data/products")
    const handles = await getAllProductHandles()
    expect(handles.length).toBe(pageSize - 1)
    expect(handles[0]).toMatchObject({
      handle: firstHandle,
      updatedAt: createdAt,
    })
    expect(list).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        offset: pageSize,
      })
    )
  })
})
