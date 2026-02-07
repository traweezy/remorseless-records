import { faker } from "@faker-js/faker"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { humanizeCategoryHandle } from "@/lib/products/categories"

describe("getMetalGenreCategories", () => {
  beforeEach(() => {
    faker.seed(2401)
  })

  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it("extracts and flattens metal subtree", async () => {
    const metalLabel = faker.music.genre()
    const childHandle = faker.helpers.slugify(faker.music.genre()).toLowerCase()
    const childLabel = faker.music.genre()
    const rank = faker.number.int({ min: 1, max: 20 })

    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/lib/medusa", () => ({
      storeClient: {
        category: {
          list: vi.fn().mockResolvedValue({
            product_categories: [
              {
                handle: "genres",
                category_children: [
                  {
                    id: faker.string.uuid(),
                    handle: "metal",
                    name: metalLabel,
                    category_children: [
                      {
                        id: faker.string.uuid(),
                        handle: childHandle,
                        name: childLabel,
                        rank,
                        category_children: [],
                      },
                    ],
                  },
                ],
              },
            ],
          }),
        },
      },
    }))

    const { getMetalGenreCategories } = await import("@/lib/data/categories")
    const categories = await getMetalGenreCategories()

    expect(categories).toHaveLength(1)
    expect(typeof categories[0]?.id).toBe("string")
    expect(categories[0]).toMatchObject({
      handle: childHandle,
      label: childLabel,
      rank,
      path: [metalLabel, childLabel],
    })
  })

  it("returns empty list when medusa call fails", async () => {
    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/lib/medusa", () => ({
      storeClient: {
        category: {
          list: vi.fn().mockRejectedValue(new Error("boom")),
        },
      },
    }))
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const { getMetalGenreCategories } = await import("@/lib/data/categories")
    await expect(getMetalGenreCategories()).resolves.toEqual([])
    expect(errorSpy).toHaveBeenCalled()
  })

  it("returns empty list when genres or metal root is missing", async () => {
    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/lib/medusa", () => ({
      storeClient: {
        category: {
          list: vi.fn().mockResolvedValue({
            product_categories: [
              {
                id: faker.string.uuid(),
                handle: faker.helpers.slugify(faker.music.genre()).toLowerCase(),
                category_children: [],
              },
            ],
          }),
        },
      },
    }))

    const { getMetalGenreCategories } = await import("@/lib/data/categories")
    await expect(getMetalGenreCategories()).resolves.toEqual([])
  })

  it("falls back to humanized labels and default rank when names are missing", async () => {
    const childHandle = faker.helpers.slugify(faker.music.genre()).toLowerCase()
    const childLabel = humanizeCategoryHandle(childHandle)

    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/lib/medusa", () => ({
      storeClient: {
        category: {
          list: vi.fn().mockResolvedValue({
            product_categories: [
              {
                handle: "genres",
                category_children: [
                  {
                    id: faker.string.uuid(),
                    handle: "metal",
                    name: "",
                    category_children: [
                      {
                        id: faker.string.uuid(),
                        handle: childHandle,
                        name: "",
                        category_children: [],
                      },
                    ],
                  },
                ],
              },
            ],
          }),
        },
      },
    }))

    const { getMetalGenreCategories } = await import("@/lib/data/categories")
    const categories = await getMetalGenreCategories()
    expect(categories).toHaveLength(1)
    expect(categories[0]).toMatchObject({
      handle: childHandle,
      label: childLabel,
      rank: Number.MAX_SAFE_INTEGER,
      path: ["Metal", childLabel],
    })
  })
})
