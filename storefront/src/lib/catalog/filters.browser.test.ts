import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  fetchCatalogFilterOptions,
  fetchCatalogPriceRange,
} from "@/lib/catalog/filters.browser"

describe("fetchCatalogFilterOptions", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("loads each filter dimension from its dedicated endpoint", async () => {
    const payload = {
      options: [{ value: "Vinyl", label: "Vinyl", count: 42 }],
    }
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }))
    const controller = new AbortController()

    await expect(
      fetchCatalogFilterOptions("formats", { signal: controller.signal })
    ).resolves.toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith("/api/catalog/filters/formats", {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
  })

  it("rejects failed and malformed endpoint responses", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
    fetchMock.mockResolvedValueOnce(
      new Response("unavailable", { status: 503 })
    )
    await expect(fetchCatalogFilterOptions("genres")).rejects.toThrow(
      "status 503"
    )

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ options: [{ value: "Vinyl" }] }), {
        status: 200,
      })
    )
    await expect(fetchCatalogFilterOptions("formats")).rejects.toThrow(
      "invalid option"
    )
  })

  it("loads and validates the dedicated price range endpoint", async () => {
    const payload = { range: { min: 100, max: 5_600, currency: "usd" } }
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }))

    await expect(fetchCatalogPriceRange()).resolves.toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith("/api/catalog/filters/price-range", {
      headers: { Accept: "application/json" },
    })

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ range: { min: 5_600, max: 100, currency: "usd" } }),
        { status: 200 }
      )
    )
    await expect(fetchCatalogPriceRange()).rejects.toThrow("invalid values")
  })
})
