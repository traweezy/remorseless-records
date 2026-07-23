import { faker } from "@faker-js/faker"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  computeFacetCounts,
  searchProductsWithClient,
} from "@/lib/search/search"
import type { ProductSearchHit } from "@/types/product"

type MockIndex = {
  uid: string
  getSettings: ReturnType<typeof vi.fn>
  search: ReturnType<typeof vi.fn>
}

const makeHit = (overrides: Record<string, unknown> = {}) => ({
  id: faker.string.uuid(),
  handle: faker.helpers.slugify(faker.music.songName()).toLowerCase(),
  title: "Ulcerate - Shrines",
  category_handles: ["vinyl", "doom"],
  category_labels: ["Vinyl", "Doom"],
  variant_titles: ["LP", "CD"],
  genres: ["Doom"],
  metal_genres: ["Doom"],
  format: "LP",
  stock_status: "in_stock",
  default_variant_id: "variant-1",
  price_amount: 2500,
  ...overrides,
})

const makeClient = (index: MockIndex) =>
  ({
    index: vi.fn().mockReturnValue(index),
  }) as never

describe("computeFacetCounts", () => {
  it("counts genres, formats, categories, variants, and product types", () => {
    const hit = {
      id: "1",
      handle: "release-1",
      title: "Release",
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
      formats: ["Vinyl"],
      genres: ["Doom", "Death"],
      metalGenres: ["Doom"],
      categories: ["Vinyl"],
      categoryHandles: ["vinyl"],
      variantTitles: ["LP"],
      format: "Vinyl",
      availabilityStates: ["in_stock"],
      stockStatuses: ["in_stock"],
      bundleType: "fixed",
      productType: "album",
    } satisfies ProductSearchHit

    expect(computeFacetCounts([hit])).toEqual({
      genres: { Doom: 1, Death: 1 },
      metalGenres: { Doom: 1 },
      format: { Vinyl: 1 },
      categories: { vinyl: 1 },
      variants: { LP: 1 },
      productTypes: { album: 1 },
      availabilityStates: { in_stock: 1 },
      stockStatuses: { in_stock: 1 },
      bundleTypes: { fixed: 1 },
    })
  })

  it("ignores blank facet values", () => {
    const hit = {
      id: "1",
      handle: "release-1",
      title: "Release",
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
      formats: [],
      genres: ["", "  "],
      metalGenres: ["", "  "],
      categories: [],
      categoryHandles: ["", "  "],
      variantTitles: ["", "  "],
      format: "  ",
      availabilityStates: ["", "  "],
      stockStatuses: ["unknown"],
      bundleType: "  ",
      productType: "  ",
    } satisfies ProductSearchHit

    expect(computeFacetCounts([hit])).toEqual({
      genres: {},
      metalGenres: {},
      format: {},
      categories: {},
      variants: {},
      productTypes: {},
      availabilityStates: {},
      stockStatuses: { unknown: 1 },
      bundleTypes: {},
    })
  })
})

describe("searchProductsWithClient", () => {
  beforeEach(() => {
    faker.seed(222)
  })

  it("queries meilisearch with server-side filter expression and sort", async () => {
    const index: MockIndex = {
      uid: "products",
      getSettings: vi.fn().mockResolvedValue({
        filterableAttributes: [
          "genres",
          "formats",
          "category_handles",
          "variant_titles",
          "product_type",
          "status",
          "availability_states",
          "stock_status",
          "price_min",
          "price_max",
        ],
      }),
      search: vi.fn().mockResolvedValue({
        hits: [makeHit()],
        estimatedTotalHits: 1,
        facetDistribution: {
          genres: { Doom: 1 },
          formats: { LP: 1 },
          category_handles: { doom: 1 },
          variant_titles: { LP: 1 },
          product_type: { album: 1 },
          availability_states: { in_stock: 1 },
          stock_statuses: { in_stock: 1 },
          bundle_type: { fixed: 1 },
        },
      }),
    }

    const response = await searchProductsWithClient(makeClient(index), {
      query: "doom",
      limit: 24,
      offset: 0,
      inStockOnly: true,
      sort: "price-low",
      filters: {
        genres: ["Doom"],
        formats: ["Vinyl"],
        categories: ["doom", "grind"],
        variants: ["LP"],
        productTypes: ["album"],
        availability: ["in_stock"],
        price: { min: 1000, max: 3000 },
      },
    })

    expect(index.getSettings).toHaveBeenCalledTimes(1)
    expect(index.search).toHaveBeenCalledTimes(1)
    expect(index.search).toHaveBeenCalledWith("doom", {
      limit: 24,
      offset: 0,
      facets: [
        "genres",
        "metalGenres",
        "formats",
        "format",
        "product_type",
        "availability_states",
        "stock_statuses",
        "bundle_type",
        "category_handles",
        "variant_titles",
      ],
      filter:
        'status = "published" AND genres IN ["Doom"] AND (formats IN ["Vinyl"] OR variant_titles IN ["Vinyl"]) AND category_handles IN ["doom", "grind"] AND variant_titles IN ["LP"] AND product_type IN ["album"] AND availability_states IN ["in_stock"] AND price_max >= 1000 AND price_min <= 3000 AND (stock_status != "sold_out")',
      sort: ["price_amount:asc"],
    })
    expect(response.total).toBe(1)
    expect(response.hits).toHaveLength(1)
    expect(response.facets.productTypes).toEqual({ album: 1 })
  })

  it("applies client-side post filtering when attributes are not filterable", async () => {
    const index: MockIndex = {
      uid: "products-postfilter",
      getSettings: vi.fn().mockResolvedValue({
        filterableAttributes: ["genres"],
      }),
      search: vi.fn().mockResolvedValue({
        hits: [
          makeHit({
            handle: "match",
            category_handles: ["doom", "vinyl"],
            format: "LP",
            variant_titles: ["LP"],
          }),
          makeHit({
            handle: "no-match",
            category_handles: ["black-metal"],
            format: "CD",
            variant_titles: ["CD"],
          }),
        ],
        facetDistribution: {
          genres: { Doom: 2 },
        },
      }),
    }

    const response = await searchProductsWithClient(makeClient(index), {
      query: "doom",
      limit: 24,
      filters: {
        genres: ["Doom"],
        categories: ["doom"],
        formats: ["Vinyl"],
        variants: ["LP"],
      },
    })

    expect(index.search).toHaveBeenCalledWith(
      "doom",
      expect.objectContaining({
        filter: 'genres IN ["Doom"]',
      })
    )
    expect(response.total).toBe(1)
    expect(response.hits).toHaveLength(1)
    expect(response.hits[0]?.handle).toBe("match")
  })

  it("post-filters availability and price ranges when they are not filterable", async () => {
    const index: MockIndex = {
      uid: "products-postfilter-price-availability",
      getSettings: vi.fn().mockResolvedValue({
        filterableAttributes: [],
      }),
      search: vi.fn().mockResolvedValue({
        hits: [
          makeHit({
            handle: "match",
            availability_states: ["preorder"],
            price_min: 1200,
            price_max: 2000,
          }),
          makeHit({
            handle: "wrong-availability",
            availability_states: ["in_stock"],
            price_min: 1200,
            price_max: 2000,
          }),
          makeHit({
            handle: "too-cheap",
            availability_states: ["preorder"],
            price_min: 500,
            price_max: 900,
          }),
          makeHit({
            handle: "too-expensive",
            availability_states: ["preorder"],
            price_min: 2600,
            price_max: 3200,
          }),
          makeHit({
            handle: "missing-price",
            availability_states: ["preorder"],
            price_amount: null,
            price_min: null,
            price_max: null,
          }),
        ],
        facetDistribution: undefined,
      }),
    }

    const response = await searchProductsWithClient(makeClient(index), {
      query: "preorder",
      limit: 24,
      filters: {
        availability: ["preorder"],
        price: { min: 1000, max: 2500 },
      },
    })

    expect(index.search).toHaveBeenCalledTimes(1)
    expect(
      (index.search.mock.calls[0]?.[1] as { filter?: unknown } | undefined)
        ?.filter
    ).toBeUndefined()
    expect(response.total).toBe(1)
    expect(response.hits.map((hit) => hit.handle)).toEqual(["match"])
    expect(response.facets.availabilityStates).toEqual({ preorder: 1 })
  })

  it("filters draft search hits when status is not filterable", async () => {
    const index: MockIndex = {
      uid: "products-status-postfilter",
      getSettings: vi.fn().mockResolvedValue({
        filterableAttributes: [],
      }),
      search: vi.fn().mockResolvedValue({
        hits: [
          makeHit({ handle: "published-record", status: "published" }),
          makeHit({ handle: "draft-record", status: "draft" }),
        ],
        facetDistribution: undefined,
      }),
    }

    const response = await searchProductsWithClient(makeClient(index), {
      query: "",
      limit: 24,
    })

    expect(
      (index.search.mock.calls[0]?.[1] as { filter?: unknown } | undefined)
        ?.filter
    ).toBeUndefined()
    expect(response.hits.map((hit) => hit.handle)).toEqual(["published-record"])
  })

  it("builds server-side min-only and max-only price filters", async () => {
    const minIndex: MockIndex = {
      uid: "products-price-min-filter",
      getSettings: vi.fn().mockResolvedValue({
        filterableAttributes: [
          "price_min",
          "price_max",
          123,
          { attribute: 123 },
        ],
      }),
      search: vi.fn().mockResolvedValue({
        hits: [makeHit({ price_min: 1000, price_max: 1500 })],
        facetDistribution: undefined,
      }),
    }
    const maxIndex: MockIndex = {
      uid: "products-price-max-filter",
      getSettings: vi.fn().mockResolvedValue({
        filterableAttributes: ["price_min", "price_max"],
      }),
      search: vi.fn().mockResolvedValue({
        hits: [makeHit({ price_min: 1000, price_max: 1500 })],
        facetDistribution: undefined,
      }),
    }

    await searchProductsWithClient(makeClient(minIndex), {
      query: "",
      limit: 1,
      filters: {
        price: { min: 1000 },
      },
    })
    await searchProductsWithClient(makeClient(maxIndex), {
      query: "",
      limit: 1,
      filters: {
        price: { max: 2000 },
      },
    })

    expect(minIndex.search).toHaveBeenCalledWith(
      "",
      expect.objectContaining({
        filter: "price_max >= 1000",
      })
    )
    expect(maxIndex.search).toHaveBeenCalledWith(
      "",
      expect.objectContaining({
        filter: "price_min <= 2000",
      })
    )
  })

  it("paginates across batches and reports hasMore/nextOffset", async () => {
    const firstBatch = Array.from({ length: 64 }, (_, index) =>
      makeHit({ handle: `release-${index}` })
    )
    const secondBatch = Array.from({ length: 20 }, (_, index) =>
      makeHit({ handle: `release-next-${index}` })
    )

    const index: MockIndex = {
      uid: "products-paged",
      getSettings: vi.fn().mockResolvedValue({
        filterableAttributes: ["genres"],
      }),
      search: vi
        .fn()
        .mockResolvedValueOnce({
          hits: firstBatch,
          facetDistribution: undefined,
        })
        .mockResolvedValueOnce({
          hits: secondBatch,
          facetDistribution: undefined,
        }),
    }

    const response = await searchProductsWithClient(makeClient(index), {
      query: "release",
      limit: 10,
      offset: 60,
    })

    expect(index.search).toHaveBeenCalledTimes(2)
    expect(response.hits).toHaveLength(10)
    expect(response.offset).toBe(60)
    expect(response.hasMore).toBe(true)
    expect(response.nextOffset).toBe(70)
  })

  it("reuses cached filterable settings across requests", async () => {
    const index: MockIndex = {
      uid: "products-cached-settings",
      getSettings: vi.fn().mockResolvedValue({
        filterableAttributes: [
          "genres",
          { attribute: "variant_titles" },
          { attribute: "category_handles" },
        ],
      }),
      search: vi.fn().mockResolvedValue({
        hits: [makeHit()],
        facetDistribution: undefined,
      }),
    }
    const client = makeClient(index)

    await searchProductsWithClient(client, {
      query: faker.music.genre(),
      limit: faker.number.int({ min: 1, max: 12 }),
      filters: { genres: [faker.music.genre()] },
    })
    await searchProductsWithClient(client, {
      query: faker.music.genre(),
      limit: faker.number.int({ min: 1, max: 12 }),
      filters: { genres: [faker.music.genre()] },
    })

    expect(index.getSettings).toHaveBeenCalledTimes(1)
    expect(index.search).toHaveBeenCalledTimes(2)
  })

  it("returns empty payload when the first batch has no hits", async () => {
    const index: MockIndex = {
      uid: "products-empty",
      getSettings: vi.fn().mockResolvedValue({
        filterableAttributes: [],
      }),
      search: vi.fn().mockResolvedValue({
        hits: [],
        facetDistribution: undefined,
      }),
    }

    const response = await searchProductsWithClient(makeClient(index), {
      query: "",
      limit: 0,
      offset: faker.number.int({ min: -200, max: -1 }),
    })

    expect(response).toMatchObject({
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
  })

  it("OR-filters category handles and canonicalizes format facets", async () => {
    const index: MockIndex = {
      uid: "products-canonical-facets",
      getSettings: vi.fn().mockResolvedValue({
        filterableAttributes: [],
      }),
      search: vi.fn().mockResolvedValue({
        hits: [
          makeHit({
            handle: "matching-record",
            category_handles: ["doom", "vinyl"],
            format: "LP",
            variant_titles: ["cd", "cassette shell"],
            formats: ["colored vinyl"],
          }),
          makeHit({
            handle: "wrong-category",
            category_handles: ["black-metal"],
            format: "CD",
          }),
        ],
        facetDistribution: {
          format: { LP: 1, cd: 1 },
          variant_titles: { "cassette shell": 1 },
        },
      }),
    }

    const response = await searchProductsWithClient(makeClient(index), {
      query: faker.music.genre(),
      limit: 10,
      filters: {
        categories: ["doom", "vinyl"],
      },
    })

    expect(response.total).toBe(1)
    expect(response.hits).toHaveLength(1)
    expect(response.hits[0]?.handle).toBe("matching-record")
    expect(typeof response.facets.format.Vinyl).toBe("number")
    expect(typeof response.facets.format.CD).toBe("number")
    expect(typeof response.facets.format.Cassette).toBe("number")
  })
})
