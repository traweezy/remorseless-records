import { faker } from "@faker-js/faker"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { searchProductsBrowser } from "@/lib/search/browser"
import type { ProductSearchResponse } from "@/lib/search/search"

const makeResponse = (): ProductSearchResponse => ({
  hits: [],
  total: 0,
  offset: 0,
  hasMore: false,
  nextOffset: 0,
  facets: {
    genres: {},
    metalGenres: {},
    format: {},
    categories: {},
    variants: {},
    productTypes: {},
    availabilityStates: {},
    stockStatuses: {},
    bundleTypes: {},
  },
})

describe("searchProductsBrowser", () => {
  beforeEach(() => {
    faker.seed(1501)
    vi.restoreAllMocks()
  })

  it("queries the protected storefront search endpoint", async () => {
    const payload = makeResponse()
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }))
    const controller = new AbortController()
    const request = { query: faker.word.noun(), limit: 60, offset: 0 }

    await expect(
      searchProductsBrowser(request, { signal: controller.signal })
    ).resolves.toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith("/api/search/products", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    })
  })

  it("rejects failed and malformed search responses", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
    fetchMock.mockResolvedValueOnce(
      new Response("unavailable", { status: 503 })
    )

    await expect(searchProductsBrowser({ query: "doom" })).rejects.toThrow(
      "status 503"
    )

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ hits: "invalid" }), { status: 200 })
    )
    await expect(searchProductsBrowser({ query: "doom" })).rejects.toThrow(
      "invalid response"
    )
  })
})
