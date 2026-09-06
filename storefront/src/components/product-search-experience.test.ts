import { Debouncer } from "@tanstack/pacer"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  mapHitToSummary,
  shouldRefreshFilterDefinitionOnIntent,
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

describe("catalog search pacing dependency contract", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const createSearchDebouncer = () => {
    const updateQuery = vi.fn<(query: string) => void>()
    const debouncer = new Debouncer(updateQuery, {
      key: "catalog-search-query-test",
      wait: 250,
    })
    return { debouncer, updateQuery }
  }

  it("commits only the latest query after a full quiet interval", () => {
    const { debouncer, updateQuery } = createSearchDebouncer()
    try {
      debouncer.maybeExecute("death")
      vi.advanceTimersByTime(200)
      debouncer.maybeExecute("death metal")
      vi.advanceTimersByTime(249)
      expect(updateQuery).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(updateQuery).toHaveBeenCalledExactlyOnceWith("death metal")
    } finally {
      debouncer.cancel()
    }
  })

  it("preserves a cleared search instead of dropping its empty value", () => {
    const { debouncer, updateQuery } = createSearchDebouncer()
    try {
      debouncer.maybeExecute("vinyl")
      debouncer.maybeExecute("")
      vi.advanceTimersByTime(250)
      expect(updateQuery).toHaveBeenCalledExactlyOnceWith("")
    } finally {
      debouncer.cancel()
    }
  })

  it("cancels pending work on cleanup and allows a fresh subscription", () => {
    const { debouncer, updateQuery } = createSearchDebouncer()
    try {
      debouncer.maybeExecute("obsolete")
      debouncer.cancel()
      vi.advanceTimersByTime(1_000)
      expect(updateQuery).not.toHaveBeenCalled()
      debouncer.maybeExecute("new release")
      vi.advanceTimersByTime(250)
      expect(updateQuery).toHaveBeenCalledExactlyOnceWith("new release")
    } finally {
      debouncer.cancel()
    }
  })
})

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

describe("shouldRefreshFilterDefinitionOnIntent", () => {
  it("refreshes every definition on first intent to replace partial server data", () => {
    expect(shouldRefreshFilterDefinitionOnIntent(false, true, false)).toBe(true)
  })

  it("retries only missing or errored definitions after first intent", () => {
    expect(shouldRefreshFilterDefinitionOnIntent(true, true, false)).toBe(false)
    expect(shouldRefreshFilterDefinitionOnIntent(true, false, false)).toBe(true)
    expect(shouldRefreshFilterDefinitionOnIntent(true, true, true)).toBe(true)
  })
})
