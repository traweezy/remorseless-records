import { beforeEach, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  cache: new Map<string, unknown>(),
  search: vi.fn(),
  definitions: vi.fn(),
}))

vi.mock("next/cache", () => ({
  unstable_cache:
    (callback: () => Promise<unknown>, keys: string[]) => async () => {
      const key = keys.join(":")
      if (mocks.cache.has(key)) return mocks.cache.get(key)
      const result = await callback()
      mocks.cache.set(key, result)
      return result
    },
}))
vi.mock("@/lib/search/server", () => ({
  searchProductsServer: mocks.search,
}))
vi.mock("@/lib/catalog/filters.server", () => ({
  getCatalogFilterDefinitions: mocks.definitions,
}))
vi.mock("@/components/product-search-experience", () => ({
  default: () => null,
}))
vi.mock("@/components/json-ld", () => ({ default: () => null }))

import ProductsPage from "./page"

beforeEach(() => {
  mocks.cache.clear()
  mocks.search.mockReset()
  mocks.definitions.mockReset()
})

it("loads corrected initial facets instead of a persisted prior cache entry", async () => {
  const corrected = {
    hits: [],
    total: 464,
    offset: 0,
    facets: { format: { CD: 282, Vinyl: 126, Cassette: 130, DVD: 1 } },
    hasMore: true,
    nextOffset: 60,
  }
  mocks.cache.set("catalog-initial-search-v1", {
    ...corrected,
    facets: { format: { CD: 664, Vinyl: 267, Cassette: 274, DVD: 2 } },
  })
  mocks.search.mockResolvedValue(corrected)
  mocks.definitions.mockResolvedValue({
    formats: [],
    genres: [],
    productTypes: [],
    priceRange: null,
  })

  const first = await ProductsPage()
  const second = await ProductsPage()
  expect(first.props.children[0].props.initialResponse).toEqual(corrected)
  expect(second.props.children[0].props.initialResponse).toEqual(corrected)
  expect(mocks.search).toHaveBeenCalledExactlyOnceWith({
    query: "",
    limit: 60,
    offset: 0,
    sort: "newest",
    inStockOnly: false,
  })
})
