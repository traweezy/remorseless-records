import { describe, expect, it } from "vitest"

import { resolveCollectionRibbonLabel } from "@/components/product-card"
import type { ProductSearchHit } from "@/types/product"

const searchHit: ProductSearchHit = {
  id: "prod_1",
  handle: "music-release-artist-album",
  title: "Artist - Album",
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
  formats: ["Vinyl"],
  genres: ["Death Metal"],
  metalGenres: ["Death Metal"],
  categories: [],
  categoryHandles: [],
  variantTitles: ["Vinyl"],
  ribbonLabel: "Staff Pick",
  ribbonPriority: 20,
}

describe("product card ribbons", () => {
  it("uses the client-prioritized ribbon indexed with a search hit", () => {
    expect(resolveCollectionRibbonLabel(searchHit, searchHit)).toBe("Staff Pick")
  })
})
