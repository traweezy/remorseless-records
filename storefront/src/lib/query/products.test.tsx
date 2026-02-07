import { faker } from "@faker-js/faker"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook } from "@testing-library/react"
import { type ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { searchProductsBrowser } from "@/lib/search/browser"
import {
  prefetchProductDetail,
  prefetchProductSearch,
  productDetailQueryKey,
  productDetailQueryOptions,
  productSearchQueryKey,
  productSearchQueryOptions,
  useProductDetailPrefetch,
} from "@/lib/query/products"

vi.mock("@/lib/search/browser", () => ({
  searchProductsBrowser: vi.fn(),
}))

const mockedSearchProductsBrowser = vi.mocked(searchProductsBrowser)

describe("product query helpers", () => {
  beforeEach(() => {
    faker.seed(111)
    mockedSearchProductsBrowser.mockReset()
  })

  it("builds product detail query key and options", async () => {
    const handle = faker.helpers.slugify("Hidden History").toLowerCase()
    const product = { id: faker.string.uuid(), handle } as never
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ product }),
      } as Response)

    const options = productDetailQueryOptions(handle)
    expect(productDetailQueryKey(handle)).toEqual(["product", handle])
    expect(options.queryKey).toEqual(["product", handle])
    await expect(options.queryFn()).resolves.toEqual(product)

    fetchSpy.mockRestore()
  })

  it("throws from product detail query when fetch fails", async () => {
    const handle = "not-found"
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve({}),
      } as Response)

    await expect(productDetailQueryOptions(handle).queryFn()).rejects.toThrow(
      "Failed to load product (status 503)"
    )

    fetchSpy.mockRestore()
  })

  it("builds stable normalized search query keys", () => {
    const key = productSearchQueryKey({
      query: "  doom  ",
      genres: ["sludge", "doom"],
      categories: ["vinyl", "cassette"],
      variants: ["LP", "CD"],
      formats: ["Cassette", "Vinyl"],
      inStockOnly: true,
      sort: "newest",
      limit: 48,
    })

    expect(key).toEqual([
      "search",
      "doom",
      ["doom", "sludge"],
      ["cassette", "vinyl"],
      ["CD", "LP"],
      ["Cassette", "Vinyl"],
      48,
      "newest",
      "in-stock",
    ])
  })

  it("delegates search query function to browser search", async () => {
    const response = {
      hits: [],
      total: 0,
      offset: 0,
      facets: {
        genres: {},
        metalGenres: {},
        format: {},
        categories: {},
        variants: {},
        productTypes: {},
      },
    }
    mockedSearchProductsBrowser.mockResolvedValue(response)

    const options = productSearchQueryOptions({
      query: "ritual",
      genres: [],
      categories: [],
      variants: [],
    })

    await expect(options.queryFn()).resolves.toEqual(response)
    expect(mockedSearchProductsBrowser).toHaveBeenCalledWith({
      query: "ritual",
      limit: 24,
      filters: {
        genres: [],
        categories: [],
        variants: [],
        formats: [],
      },
      inStockOnly: false,
      sort: "title-asc",
    })
  })

  it("prefetches detail and search queries", async () => {
    const queryClient = new QueryClient()
    const detailSpy = vi
      .spyOn(queryClient, "prefetchQuery")
      .mockResolvedValue(undefined)

    await prefetchProductDetail(queryClient, "release")
    await prefetchProductSearch(queryClient, {
      query: "release",
      genres: [],
      categories: [],
      variants: [],
    })

    expect(detailSpy).toHaveBeenCalledTimes(2)
  })
})

describe("useProductDetailPrefetch", () => {
  it("prefetches only once per handle", () => {
    const queryClient = new QueryClient()
    const prefetchSpy = vi
      .spyOn(queryClient, "prefetchQuery")
      .mockResolvedValue(undefined)

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useProductDetailPrefetch("release"), {
      wrapper,
    })

    result.current()
    result.current()
    expect(prefetchSpy).toHaveBeenCalledTimes(1)
  })

  it("does nothing when handle is empty", () => {
    const queryClient = new QueryClient()
    const prefetchSpy = vi
      .spyOn(queryClient, "prefetchQuery")
      .mockResolvedValue(undefined)

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useProductDetailPrefetch(""), { wrapper })
    result.current()
    expect(prefetchSpy).not.toHaveBeenCalled()
  })
})
