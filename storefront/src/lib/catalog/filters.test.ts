import { describe, expect, it } from "vitest"

import {
  buildCatalogFilterDefinitions,
  formatProductTypeLabel,
} from "@/lib/catalog/filters"
import type { ProductSearchHit } from "@/types/product"

const makeHit = (
  handle: string,
  overrides: Partial<ProductSearchHit> = {}
): ProductSearchHit => ({
  id: handle,
  handle,
  title: handle,
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
  genres: [],
  metalGenres: [],
  categories: [],
  categoryHandles: [],
  variantTitles: [],
  ...overrides,
})

describe("buildCatalogFilterDefinitions", () => {
  it("builds stable catalog-wide options and counts each product once", () => {
    const definitions = buildCatalogFilterDefinitions(
      [
        makeHit("vinyl-release", {
          format: "LP",
          formats: ["colored vinyl"],
          variantTitles: ["12-inch vinyl", "CD"],
          categoryHandles: ["death-metal"],
          productType: "music_release",
          priceAmount: 2_500,
          defaultVariant: {
            id: "vinyl",
            title: "Vinyl",
            currency: "usd",
            amount: 2_500,
            hasPrice: true,
            inStock: true,
            stockStatus: "in_stock",
            inventoryQuantity: 10,
          },
        }),
        makeHit("dvd-release", {
          variantTitles: ["DVD"],
          categoryHandles: ["doom-metal"],
          productType: "music-release",
          priceAmount: 1_000,
        }),
        makeHit("shirt", {
          categoryHandles: ["death-metal"],
          productType: "merch",
        }),
      ],
      [
        { handle: "doom-metal", label: "Doom Metal", rank: 0 },
        { handle: "death-metal", label: "Death Metal", rank: 1 },
        { handle: "unused", label: "Unused", rank: 2 },
      ]
    )

    expect(definitions.formats).toEqual([
      { value: "Vinyl", label: "Vinyl", count: 1 },
      { value: "CD", label: "CD", count: 1 },
      { value: "DVD", label: "DVD", count: 1 },
    ])
    expect(definitions.genres).toEqual([
      { value: "doom-metal", label: "Doom Metal", count: 1 },
      { value: "death-metal", label: "Death Metal", count: 2 },
    ])
    expect(definitions.productTypes).toEqual([
      { value: "music-release", label: "Music Releases", count: 2 },
      { value: "merch", label: "Merchandise", count: 1 },
    ])
    expect(definitions.priceRange).toEqual({
      min: 1_000,
      max: 2_500,
      currency: "usd",
    })
  })

  it("uses customer-facing product type labels", () => {
    expect(formatProductTypeLabel("fixed_bundle")).toBe("Fixed Bundles")
    expect(formatProductTypeLabel("tour-poster")).toBe("Tour Poster")
  })

  it("uses authoritative global facets when Store metadata is unavailable", () => {
    const definitions = buildCatalogFilterDefinitions(
      [makeHit("record", { formats: ["CD"] })],
      [{ handle: "death-metal", label: "Death Metal", rank: 0 }],
      {
        genres: { "Death Metal": 12, "Doom/Sludge Metal": 4 },
        productTypes: { music_release: 10, merch: 2 },
      }
    )

    expect(definitions.genres).toEqual([
      { value: "death-metal", label: "Death Metal", count: 12 },
      {
        value: "doom-sludge-metal",
        label: "Doom/Sludge Metal",
        count: 4,
      },
    ])
    expect(definitions.productTypes).toEqual([
      { value: "music-release", label: "Music Releases", count: 10 },
      { value: "merch", label: "Merchandise", count: 2 },
    ])
    expect(definitions.priceRange).toBeNull()
  })
})
