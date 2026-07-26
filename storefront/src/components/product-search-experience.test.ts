import { describe, expect, it } from "vitest"

import { mapHitToSummary } from "@/components/product-search-experience"
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
