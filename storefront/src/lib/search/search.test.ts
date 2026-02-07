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

const makeClient = (index: MockIndex) => ({
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
      productType: "album",
    } satisfies ProductSearchHit

    expect(computeFacetCounts([hit])).toEqual({
      genres: { Doom: 1, Death: 1 },
      metalGenres: { Doom: 1 },
      format: { Vinyl: 1 },
      categories: { vinyl: 1 },
      variants: { LP: 1 },
      productTypes: { album: 1 },
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
          "format",
          "category_handles",
          "variant_titles",
          "product_type",
        ],
      }),
      search: vi.fn().mockResolvedValue({
        hits: [makeHit()],
        facetDistribution: {
          genres: { Doom: 1 },
          format: { LP: 1 },
          category_handles: { doom: 1 },
          variant_titles: { LP: 1 },
          product_type: { album: 1 },
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
        categories: ["doom"],
        variants: ["LP"],
        productTypes: ["album"],
      },
    })

    expect(index.getSettings).toHaveBeenCalledTimes(1)
    expect(index.search).toHaveBeenCalledTimes(1)
    expect(index.search).toHaveBeenCalledWith("doom", {
      limit: 64,
      offset: 0,
      facets: ["genres", "metalGenres", "format", "product_type", "category_handles", "variant_titles"],
      filter:
        'genres IN ["Doom"] AND format IN ["Vinyl"] AND variant_titles IN ["LP"] AND product_type IN ["album"] AND (stock_status != "sold_out")',
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
      },
    })
  })

  it("post-filters category handles and canonicalizes format facets", async () => {
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
            category_handles: ["doom"],
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
