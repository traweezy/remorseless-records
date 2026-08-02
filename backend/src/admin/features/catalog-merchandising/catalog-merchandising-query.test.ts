import type { AdminSdkClient } from "../../lib/admin-request"
import {
  catalogProductPageSize,
  loadCatalogProductPage,
  loadCatalogProductsById,
  normalizeCatalogProductIds,
  normalizeCatalogProductSearch,
} from "./catalog-merchandising-query"

const productResponse = {
  count: 2,
  limit: 20,
  offset: 0,
  products: [
    {
      handle: " first-record ",
      id: "prod_1",
      thumbnail: null,
      title: " First Record ",
    },
    {
      handle: null,
      id: "prod_2",
      thumbnail: " https://example.com/second.jpg ",
      title: null,
    },
  ],
}

describe("catalog merchandising product queries", () => {
  it("normalizes bounded product search input", () => {
    expect(normalizeCatalogProductSearch("  newest   arrivals  ")).toBe(
      "newest arrivals",
    )
    expect(normalizeCatalogProductSearch("x".repeat(110))).toHaveLength(100)
  })

  it("deduplicates selected product ids without empty values", () => {
    expect(
      normalizeCatalogProductIds(["prod_2", " prod_1 ", "", "prod_2"]),
    ).toEqual(["prod_2", "prod_1"])
  })

  it("requests a bounded server-side product search page", async () => {
    const fetch = jest.fn().mockResolvedValue(productResponse)
    const client: AdminSdkClient = { fetch }

    await expect(
      loadCatalogProductPage({
        client,
        offset: 40,
        search: "  newest   arrivals ",
      }),
    ).resolves.toEqual({
      count: 2,
      limit: 20,
      offset: 0,
      products: [
        {
          handle: "first-record",
          id: "prod_1",
          thumbnail: null,
          title: "First Record",
        },
        {
          handle: null,
          id: "prod_2",
          thumbnail: "https://example.com/second.jpg",
          title: "Untitled product",
        },
      ],
    })
    expect(fetch).toHaveBeenCalledWith(
      "/admin/products",
      expect.objectContaining({
        query: {
          fields: "id,title,handle,thumbnail",
          limit: catalogProductPageSize,
          offset: 40,
          order: "title",
          q: "newest arrivals",
        },
      }),
    )
  })

  it("batch-loads exact selected products in one request", async () => {
    const fetch = jest.fn().mockResolvedValue(productResponse)
    const client: AdminSdkClient = { fetch }

    await loadCatalogProductsById({
      client,
      ids: ["prod_2", "prod_1", "prod_2"],
    })

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(
      "/admin/products",
      expect.objectContaining({
        query: expect.objectContaining({
          id: ["prod_2", "prod_1"],
          limit: 2,
        }),
      }),
    )
  })

  it("does not request an empty selected-product set", async () => {
    const fetch = jest.fn()
    const client: AdminSdkClient = { fetch }

    await expect(
      loadCatalogProductsById({ client, ids: [" "] }),
    ).resolves.toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })
})
