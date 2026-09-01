import { describe, expect, it } from "vitest"

import {
  mapHitToSummary,
  shouldRefreshInitialSearch,
} from "@/components/product-search-experience"
import type { ProductSearchResponse } from "@/lib/search/search"
import type { ProductSearchHit } from "@/types/product"

const searchHit: ProductSearchHit = {
  id: "prod_catalog_ribbon",
  handle: "music-release-artist-album",
  title: "Album",
  artist: "Artist",
  album: "Album",
  slug: {
    artist: "Artist",
    album: "Album",
    artistSlug: "artist",
    albumSlug: "album",
  },
  subtitle: "Artist",
  thumbnail: null,
  collectionTitle: null,
  defaultVariant: null,
  formats: [],
  genres: ["Death Metal"],
  metalGenres: ["Death Metal"],
  categories: [],
  categoryHandles: [],
  variantTitles: ["12-inch vinyl"],
  priceAmount: 25,
  stockStatus: "in_stock",
  ribbonLabel: "New Release",
  ribbonPriority: 10,
}

describe("mapHitToSummary", () => {
  it("preserves indexed merchandising context for the shared product card", () => {
    const mapped = mapHitToSummary(searchHit)

    expect(mapped).toMatchObject({
      ribbonLabel: "New Release",
      ribbonPriority: 10,
      variantTitles: ["12-inch vinyl"],
      formats: ["Vinyl"],
    })
  })
})

describe("shouldRefreshInitialSearch", () => {
  const response = (hits: ProductSearchHit[], total = hits.length) =>
    ({
      hits,
      total,
      offset: 0,
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
      hasMore: false,
    }) satisfies ProductSearchResponse

  it("keeps valid server-rendered catalog results fresh on hydration", () => {
    expect(shouldRefreshInitialSearch(true, response([searchHit]))).toBe(false)
  })

  it("retries only an empty unfiltered server response", () => {
    expect(shouldRefreshInitialSearch(true, response([]))).toBe(true)
    expect(shouldRefreshInitialSearch(false, response([]))).toBe(false)
    expect(shouldRefreshInitialSearch(true, response([], 1))).toBe(false)
  })
})
