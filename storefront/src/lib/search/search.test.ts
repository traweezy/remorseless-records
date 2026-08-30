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
  price_amount: 25,
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

    const response = await searchProductsWithClient(
      makeClient(index),
      {
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
          price: { min: 10, max: 30 },
        },
      },
      [
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
      ]
    )

    expect(index.getSettings).not.toHaveBeenCalled()
    expect(index.search).toHaveBeenCalledTimes(1)
    expect(index.search).toHaveBeenCalledWith("doom", {
      limit: 24,
      offset: 0,
      attributesToSearchOn: [
        "title",
        "release_title",
        "artist_names",
        "artist",
      ],
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
        'status = "published" AND genres IN ["Doom"] AND (formats IN ["Vinyl"] OR variant_titles IN ["Vinyl"]) AND category_handles IN ["doom", "grind"] AND variant_titles IN ["LP"] AND product_type IN ["album"] AND availability_states IN ["in_stock"] AND price_max >= 10 AND price_min <= 30 AND (stock_status != "sold_out")',
      sort: ["price_amount:asc", "id:asc"],
    })
    expect(response.total).toBe(1)
    expect(response.hits).toHaveLength(1)
    expect(response.facets.productTypes).toEqual({ album: 1 })
  })

  it("passes caller cancellation to every Meilisearch request", async () => {
    const index: MockIndex = {
      uid: "products-deadline",
      getSettings: vi.fn(),
      search: vi.fn().mockResolvedValue({
        hits: [],
        estimatedTotalHits: 0,
        facetDistribution: undefined,
      }),
    }
    const controller = new AbortController()

    await searchProductsWithClient(
      makeClient(index),
      { query: "deadline", limit: 1 },
      undefined,
      controller.signal
    )

    expect(index.search).toHaveBeenCalledWith("deadline", expect.any(Object), {
      signal: controller.signal,
    })
  })

  it.each([
    {
      label: "generic facet",
      filters: { genres: ['Doom\\") OR status = "draft'] },
      filterableAttributes: ["status", "genres"],
      expected: String.raw`status = "published" AND genres IN ["Doom\\\") OR status = \"draft"]`,
    },
    {
      label: "format facet",
      filters: { formats: ['Vinyl\\") OR status = "draft'] },
      filterableAttributes: ["status", "formats", "variant_titles"],
      expected: String.raw`status = "published" AND (formats IN ["Vinyl\\\") OR status = \"draft"] OR variant_titles IN ["Vinyl\\\") OR status = \"draft"])`,
    },
    {
      label: "category facet",
      filters: { categories: ['vinyl\\"] OR status = "draft'] },
      filterableAttributes: ["status", "category_handles"],
      expected: String.raw`status = "published" AND category_handles IN ["vinyl\\\"] OR status = \"draft"]`,
    },
    {
      label: "control-character facet",
      filters: { genres: ["line\nbreak\t\\"] },
      filterableAttributes: ["status", "genres"],
      expected: String.raw`status = "published" AND genres IN ["line\nbreak\t\\"]`,
    },
  ])(
    "escapes filter grammar in $label values",
    async ({ filters, filterableAttributes, expected }) => {
      const index: MockIndex = {
        uid: "products-filter-escaping",
        getSettings: vi.fn(),
        search: vi.fn().mockResolvedValue({
          hits: [],
          estimatedTotalHits: 0,
          facetDistribution: undefined,
        }),
      }

      await searchProductsWithClient(
        makeClient(index),
        { query: "", limit: 24, filters },
        filterableAttributes
      )

      expect(index.search).toHaveBeenCalledWith(
        "",
        expect.objectContaining({ filter: expected })
      )
    }
  )

  it("sorts artists deterministically using indexed sort fields", async () => {
    const index: MockIndex = {
      uid: "products-artist-sort",
      getSettings: vi.fn(),
      search: vi.fn().mockResolvedValue({
        hits: [makeHit()],
        estimatedTotalHits: 1,
        facetDistribution: undefined,
      }),
    }

    await searchProductsWithClient(
      makeClient(index),
      { query: "", limit: 24, sort: "artist-desc" },
      []
    )

    expect(index.search).toHaveBeenCalledWith(
      "",
      expect.objectContaining({
        sort: ["artist_sort:desc", "title_sort:asc", "id:asc"],
      })
    )
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

    const response = await searchProductsWithClient(
      makeClient(index),
      {
        query: "doom",
        limit: 24,
        filters: {
          genres: ["Doom"],
          categories: ["doom"],
          formats: ["Vinyl"],
          variants: ["LP"],
        },
      },
      ["genres"]
    )

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
            price_min: 12,
            price_max: 20,
          }),
          makeHit({
            handle: "wrong-availability",
            availability_states: ["in_stock"],
            price_min: 12,
            price_max: 20,
          }),
          makeHit({
            handle: "too-cheap",
            availability_states: ["preorder"],
            price_min: 5,
            price_max: 9,
          }),
          makeHit({
            handle: "too-expensive",
            availability_states: ["preorder"],
            price_min: 26,
            price_max: 32,
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

    const response = await searchProductsWithClient(
      makeClient(index),
      {
        query: "preorder",
        limit: 24,
        filters: {
          availability: ["preorder"],
          price: { min: 10, max: 25 },
        },
      },
      []
    )

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

    const response = await searchProductsWithClient(
      makeClient(index),
      {
        query: "",
        limit: 24,
      },
      []
    )

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
        hits: [makeHit({ price_min: 10, price_max: 15 })],
        facetDistribution: undefined,
      }),
    }
    const maxIndex: MockIndex = {
      uid: "products-price-max-filter",
      getSettings: vi.fn().mockResolvedValue({
        filterableAttributes: ["price_min", "price_max"],
      }),
      search: vi.fn().mockResolvedValue({
        hits: [makeHit({ price_min: 10, price_max: 15 })],
        facetDistribution: undefined,
      }),
    }

    await searchProductsWithClient(
      makeClient(minIndex),
      {
        query: "",
        limit: 1,
        filters: {
          price: { min: 10 },
        },
      },
      ["price_min", "price_max"]
    )
    await searchProductsWithClient(
      makeClient(maxIndex),
      {
        query: "",
        limit: 1,
        filters: {
          price: { max: 20 },
        },
      },
      ["price_min", "price_max"]
    )

    expect(minIndex.search).toHaveBeenCalledWith(
      "",
      expect.objectContaining({
        filter: "price_max >= 10",
      })
    )
    expect(maxIndex.search).toHaveBeenCalledWith(
      "",
      expect.objectContaining({
        filter: "price_min <= 20",
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

    const response = await searchProductsWithClient(
      makeClient(index),
      {
        query: "release",
        limit: 10,
        offset: 60,
      },
      ["genres"]
    )

    expect(index.search).toHaveBeenCalledTimes(2)
    expect(response.hits).toHaveLength(10)
    expect(response.offset).toBe(60)
    expect(response.hasMore).toBe(true)
    expect(response.nextOffset).toBe(70)
  })

  it("caps direct callers to the bounded result window", async () => {
    const index: MockIndex = {
      uid: "products-bounded-window",
      getSettings: vi.fn(),
      search: vi.fn().mockResolvedValue({
        estimatedTotalHits: 20_000,
        facetDistribution: undefined,
        hits: [makeHit()],
      }),
    }

    const response = await searchProductsWithClient(
      makeClient(index),
      {
        query: "release",
        limit: 500,
        offset: 50_000,
      },
      ["status"]
    )

    expect(index.search).toHaveBeenCalledWith(
      "release",
      expect.objectContaining({ limit: 1, offset: 999 })
    )
    expect(response).toMatchObject({
      offset: 999,
      total: 1_000,
      hasMore: false,
      nextOffset: 1_000,
    })
  })

  it("caps client-side post-filter work at 2048 raw hits", async () => {
    const rawBatch = Array.from({ length: 64 }, (_, index) =>
      makeHit({ handle: `bounded-release-${index}`, status: "published" })
    )
    const index: MockIndex = {
      uid: "products-bounded-post-filter",
      getSettings: vi.fn(),
      search: vi.fn().mockResolvedValue({
        facetDistribution: undefined,
        hits: rawBatch,
      }),
    }

    const response = await searchProductsWithClient(
      makeClient(index),
      { query: "release", limit: 60, offset: 0 },
      []
    )

    expect(index.search).toHaveBeenCalledTimes(32)
    expect(index.search).toHaveBeenLastCalledWith(
      "release",
      expect.objectContaining({ limit: 64, offset: 1_984 })
    )
    expect(response.hits).toHaveLength(60)
    expect(response.total).toBe(1_000)
    expect(response.hasMore).toBe(true)
  })

  it("does not advertise a post-filter page beyond the result window", async () => {
    const rawBatch = Array.from({ length: 64 }, (_, index) =>
      makeHit({ handle: `windowed-release-${index}`, status: "published" })
    )
    const index: MockIndex = {
      uid: "products-post-filter-window",
      getSettings: vi.fn(),
      search: vi.fn().mockResolvedValue({
        facetDistribution: undefined,
        hits: rawBatch,
      }),
    }

    const response = await searchProductsWithClient(
      makeClient(index),
      { query: "release", limit: 500, offset: 50_000 },
      []
    )

    expect(response).toMatchObject({
      offset: 999,
      total: 1_000,
      hasMore: false,
      nextOffset: 1_000,
    })
    expect(response.hits).toHaveLength(1)
  })

  it("does not advertise a non-advancing post-filter page", async () => {
    const rawBatch = Array.from({ length: 64 }, (_, index) =>
      makeHit({ handle: `draft-release-${index}`, status: "draft" })
    )
    const index: MockIndex = {
      uid: "products-empty-post-filter-window",
      getSettings: vi.fn(),
      search: vi.fn().mockResolvedValue({
        facetDistribution: undefined,
        hits: rawBatch,
      }),
    }

    const response = await searchProductsWithClient(
      makeClient(index),
      { query: "release", limit: 60, offset: 0 },
      []
    )

    expect(response).toMatchObject({
      hits: [],
      total: 0,
      hasMore: false,
      nextOffset: 0,
    })
  })

  it("uses the versioned filter contract without reading index settings", async () => {
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

    expect(index.getSettings).not.toHaveBeenCalled()
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

    const response = await searchProductsWithClient(
      makeClient(index),
      {
        query: faker.music.genre(),
        limit: 10,
        filters: {
          categories: ["doom", "vinyl"],
        },
      },
      []
    )

    expect(response.total).toBe(1)
    expect(response.hits).toHaveLength(1)
    expect(response.hits[0]?.handle).toBe("matching-record")
    expect(typeof response.facets.format.Vinyl).toBe("number")
    expect(typeof response.facets.format.CD).toBe("number")
    expect(typeof response.facets.format.Cassette).toBe("number")
  })
})
