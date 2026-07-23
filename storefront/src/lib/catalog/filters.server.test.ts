import { afterEach, describe, expect, it, vi } from "vitest"

import type { ProductSearchHit } from "@/types/product"

const makeHit = (): ProductSearchHit => ({
  id: "record",
  handle: "record",
  title: "Record",
  artist: "Artist",
  album: "Album",
  slug: {
    artist: "Artist",
    album: "Album",
    artistSlug: "artist",
    albumSlug: "album",
  },
  subtitle: null,
  defaultVariant: null,
  formats: ["CD"],
  genres: [],
  metalGenres: [],
  categories: [],
  categoryHandles: [],
  variantTitles: [],
})

const makeSearchResponse = () => ({
  hits: [],
  total: 461,
  offset: 0,
  facets: {
    genres: { "Death Metal": 12 },
    metalGenres: { "Death Metal": 12 },
    format: {},
    categories: {},
    variants: {},
    productTypes: { "music-release": 10, merch: 2 },
    availabilityStates: {},
    stockStatuses: {},
    bundleTypes: {},
  },
})

const mockDependencies = ({
  hits = [makeHit()],
  searchProductsServer = vi.fn().mockResolvedValue(makeSearchResponse()),
}: {
  hits?: ProductSearchHit[]
  searchProductsServer?: ReturnType<typeof vi.fn>
} = {}) => {
  vi.doMock("next/cache", () => ({
    unstable_cache: (callback: (...args: never[]) => unknown) => callback,
  }))
  vi.doMock("@/lib/catalog/all", () => ({
    getFullCatalogHits: vi.fn().mockResolvedValue(hits),
  }))
  vi.doMock("@/lib/data/categories", () => ({
    getMetalGenreCategories: vi.fn().mockResolvedValue([
      { handle: "death-metal", label: "Death Metal", rank: 0 },
    ]),
  }))
  vi.doMock("@/lib/search/server", () => ({ searchProductsServer }))
  return searchProductsServer
}

describe("catalog filter server loaders", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it("loads independently sourced format and search definitions", async () => {
    mockDependencies()
    const {
      getCatalogFilterDefinitions,
      getCatalogFormatOptions,
      getCatalogGenreOptions,
      getCatalogProductTypeOptions,
    } = await import("@/lib/catalog/filters.server")

    await expect(getCatalogFormatOptions()).resolves.toEqual([
      { value: "CD", label: "CD", count: 1 },
    ])
    await expect(getCatalogGenreOptions()).resolves.toEqual([
      { value: "death-metal", label: "Death Metal", count: 12 },
    ])
    await expect(getCatalogProductTypeOptions()).resolves.toEqual([
      { value: "music-release", label: "Music Releases", count: 10 },
      { value: "merch", label: "Merchandise", count: 2 },
    ])
    await expect(getCatalogFilterDefinitions()).resolves.toEqual({
      formats: [{ value: "CD", label: "CD", count: 1 }],
      genres: [
        { value: "death-metal", label: "Death Metal", count: 12 },
      ],
      productTypes: [
        { value: "music-release", label: "Music Releases", count: 10 },
        { value: "merch", label: "Merchandise", count: 2 },
      ],
    })
  })

  it("retries transient search failures with backoff", async () => {
    vi.useFakeTimers()
    const searchProductsServer = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary one"))
      .mockRejectedValueOnce(new Error("temporary two"))
      .mockResolvedValue(makeSearchResponse())
    mockDependencies({ searchProductsServer })
    const { getCatalogGenreOptions } = await import(
      "@/lib/catalog/filters.server"
    )

    const pending = getCatalogGenreOptions()
    await vi.runAllTimersAsync()
    await expect(pending).resolves.toEqual([
      { value: "death-metal", label: "Death Metal", count: 12 },
    ])
    expect(searchProductsServer).toHaveBeenCalledTimes(3)
  })

  it("returns partial definitions when independent sources fail", async () => {
    vi.useFakeTimers()
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const searchProductsServer = vi.fn().mockRejectedValue("offline")
    mockDependencies({ hits: [], searchProductsServer })
    const { getCatalogFilterDefinitions, getCatalogFormatOptions } =
      await import("@/lib/catalog/filters.server")

    await expect(getCatalogFormatOptions()).rejects.toThrow(
      "returned no products"
    )
    const pending = getCatalogFilterDefinitions()
    await vi.runAllTimersAsync()
    await expect(pending).resolves.toEqual({
      formats: [],
      genres: [],
      productTypes: [],
    })
    expect(consoleError).toHaveBeenCalledTimes(2)
  })
})
