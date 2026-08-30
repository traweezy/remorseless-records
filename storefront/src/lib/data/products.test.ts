import { faker } from "@faker-js/faker"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("products data layer", () => {
  beforeEach(() => {
    faker.seed(1901)
  })

  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("loads homepage products and product by handle", async () => {
    const firstId = faker.string.uuid()
    const firstHandle = faker.helpers
      .slugify(faker.music.songName())
      .toLowerCase()
    const secondId = faker.string.uuid()
    const secondHandle = faker.helpers
      .slugify(faker.music.songName())
      .toLowerCase()
    const regionId = faker.string.uuid()

    const list = vi
      .fn()
      .mockResolvedValueOnce({
        products: [
          { id: firstId, handle: firstHandle, title: faker.music.songName() },
        ],
      })
      .mockResolvedValueOnce({
        products: [
          { id: secondId, handle: secondHandle, title: faker.music.songName() },
        ],
      })

    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/lib/medusa/read-client", () => ({
      fetchMedusaStoreRead: list,
    }))
    vi.doMock("@/lib/regions", () => ({
      resolveRegionId: vi.fn().mockResolvedValue(regionId),
    }))

    const { getHomepageProducts, getProductByHandle } = await import(
      "@/lib/data/products"
    )
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
    const validFirst = faker.helpers
      .slugify(faker.music.songName())
      .toLowerCase()
    const validSecond = faker.helpers
      .slugify(faker.music.songName())
      .toLowerCase()
    const regionId = faker.string.uuid()
    const collectionId = faker.string.uuid()
    const collectionHandle = faker.helpers
      .slugify(faker.word.words(2))
      .toLowerCase()

    const productList = vi
      .fn<() => Promise<unknown>>()
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
    const collectionList = vi.fn<() => Promise<unknown>>().mockResolvedValue({
      collections: [{ id: collectionId, handle: collectionHandle }],
    })

    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/lib/medusa/read-client", () => ({
      fetchMedusaStoreRead: vi.fn((path: string) =>
        path === "/store/collections" ? collectionList() : productList()
      ),
    }))
    vi.doMock("@/lib/regions", () => ({
      resolveRegionId: vi.fn().mockResolvedValue(regionId),
    }))

    const { getCollectionProductsByHandle } = await import(
      "@/lib/data/products"
    )
    const products = await getCollectionProductsByHandle(collectionHandle, 2)
    expect(products.map((product) => product.handle)).toEqual([
      validFirst,
      validSecond,
    ])
  })

  it("collects all product handles with updatedAt metadata", async () => {
    const updatedAt = faker.date.recent().toISOString()
    const handle = faker.helpers.slugify(faker.music.songName()).toLowerCase()
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        handles: [
          {
            created_at: faker.date.past().toISOString(),
            handle,
            id: faker.string.uuid(),
            updated_at: updatedAt,
          },
        ],
        next_cursor: null,
      }),
      ok: true,
      status: 200,
    })
    vi.stubGlobal("fetch", fetchMock)

    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/config/env", () => ({
      runtimeEnv: {
        medusaBackendUrl: "https://backend.test",
        medusaPublishableKey: "pk_test",
      },
    }))
    vi.doMock("@/lib/medusa/read-client", () => ({
      fetchMedusaStoreRead: vi.fn(),
    }))

    const { getAllProductHandles } = await import("@/lib/data/products")
    const handles = await getAllProductHandles()

    expect(handles).toHaveLength(1)
    expect(handles[0]).toMatchObject({
      handle,
      updatedAt,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      "https://backend.test/store/products/handles?limit=100",
      expect.objectContaining({
        headers: { "x-publishable-api-key": "pk_test" },
      })
    )
  })

  it("returns empty collection products when collection handle is unknown", async () => {
    const collectionHandle = faker.helpers
      .slugify(faker.word.words(2))
      .toLowerCase()

    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/lib/medusa/read-client", () => ({
      fetchMedusaStoreRead: vi.fn().mockResolvedValue({ collections: [] }),
    }))
    vi.doMock("@/lib/regions", () => ({
      resolveRegionId: vi.fn().mockResolvedValue(faker.string.uuid()),
    }))

    const { getCollectionProductsByHandle } = await import(
      "@/lib/data/products"
    )
    await expect(
      getCollectionProductsByHandle(collectionHandle)
    ).resolves.toEqual([])
  })

  it("falls back safely when list payload is malformed", async () => {
    const regionId = faker.string.uuid()
    const handle = faker.helpers.slugify(faker.music.songName()).toLowerCase()

    const list = vi
      .fn()
      .mockResolvedValueOnce({ products: null })
      .mockResolvedValueOnce({
        products: [{ id: faker.string.uuid(), handle }],
      })
      .mockResolvedValueOnce({ products: "not-an-array" })

    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/lib/medusa/read-client", () => ({
      fetchMedusaStoreRead: list,
    }))
    vi.doMock("@/lib/regions", () => ({
      resolveRegionId: vi.fn().mockResolvedValue(regionId),
    }))

    const { getHomepageProducts, getProductByHandle, getProductsByCollection } =
      await import("@/lib/data/products")
    await expect(getHomepageProducts()).resolves.toEqual([])
    await expect(getProductByHandle(handle)).resolves.toMatchObject({ handle })
    await expect(getProductsByCollection(faker.string.uuid())).resolves.toEqual(
      []
    )
  })

  it("returns null/empty values when product loaders throw", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined)
    const list = vi.fn().mockRejectedValue(new Error("boom"))
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")))

    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/lib/medusa/read-client", () => ({
      fetchMedusaStoreRead: list,
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

    await expect(
      getProductByHandle(faker.helpers.slugify(faker.music.songName()))
    ).resolves.toBeNull()
    await expect(
      getProductsByCollection(
        faker.string.uuid(),
        faker.number.int({ min: 1, max: 12 })
      )
    ).resolves.toEqual([])
    await expect(
      getRecentProducts(faker.number.int({ min: 1, max: 12 }))
    ).resolves.toEqual([])
    await expect(
      getCollectionProductsByHandle(faker.helpers.slugify(faker.word.words(2)))
    ).resolves.toEqual([])
    await expect(getAllProductHandles()).resolves.toEqual([])
    expect(errorSpy).toHaveBeenCalled()
  })

  it("uses createdAt fallback and follows the bounded keyset cursor", async () => {
    const pageSize = 100
    const firstHandle = faker.helpers
      .slugify(faker.music.songName())
      .toLowerCase()
    const createdAt = faker.date.past().toISOString()
    const firstPage = Array.from({ length: pageSize }, (_, index) => ({
      created_at: createdAt,
      handle:
        index === 0
          ? firstHandle
          : faker.helpers.slugify(faker.music.songName()).toLowerCase(),
      id: faker.string.uuid(),
      updated_at: null,
    }))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          handles: firstPage,
          next_cursor: "cursor_2",
        }),
        ok: true,
        status: 200,
      })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          handles: [],
          next_cursor: null,
        }),
        ok: true,
        status: 200,
      })
    vi.stubGlobal("fetch", fetchMock)

    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/config/env", () => ({
      runtimeEnv: {
        medusaBackendUrl: "https://backend.test",
        medusaPublishableKey: "pk_test",
      },
    }))
    vi.doMock("@/lib/medusa/read-client", () => ({
      fetchMedusaStoreRead: vi.fn(),
    }))

    const { getAllProductHandles } = await import("@/lib/data/products")
    const handles = await getAllProductHandles()
    expect(handles.length).toBe(pageSize)
    expect(handles[0]).toMatchObject({
      handle: firstHandle,
      updatedAt: createdAt,
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://backend.test/store/products/handles?limit=100&cursor=cursor_2",
      expect.any(Object)
    )
  })

  it("rejects a non-base64url cursor from the handle feed", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined)
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        handles: [],
        next_cursor: "../../invalid",
      }),
      ok: true,
      status: 200,
    })
    vi.stubGlobal("fetch", fetchMock)

    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/config/env", () => ({
      runtimeEnv: {
        medusaBackendUrl: "https://backend.test",
        medusaPublishableKey: "pk_test",
      },
    }))
    vi.doMock("@/lib/medusa/read-client", () => ({
      fetchMedusaStoreRead: vi.fn(),
    }))

    const { getAllProductHandles } = await import("@/lib/data/products")

    await expect(getAllProductHandles()).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalled()
  })

  it("loads product ids once and restores the requested order", async () => {
    const regionId = faker.string.uuid()
    const firstId = faker.string.uuid()
    const secondId = faker.string.uuid()
    const list = vi.fn().mockResolvedValue({
      products: [
        { id: firstId, handle: "first" },
        { id: secondId, handle: "second" },
      ],
    })

    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/lib/medusa/read-client", () => ({
      fetchMedusaStoreRead: list,
    }))
    vi.doMock("@/lib/regions", () => ({
      resolveRegionId: vi.fn().mockResolvedValue(regionId),
    }))

    const { getProductsByIds } = await import("@/lib/data/products")
    const products = await getProductsByIds([secondId, firstId, secondId])

    expect(products.map((product) => product.id)).toEqual([secondId, firstId])
    const [path, init] = list.mock.calls[0] as [
      string,
      { query?: Record<string, unknown> },
    ]
    expect(path).toBe("/store/products")
    expect(init.query).toMatchObject({
      id: [secondId, firstId],
      limit: 2,
    })
  })
})
