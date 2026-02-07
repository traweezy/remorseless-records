import { faker } from "@faker-js/faker"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  extractFacetMaps,
  normalizeFormatValue,
  normalizeSearchHit,
} from "@/lib/search/normalize"

describe("normalizeFormatValue", () => {
  it("normalizes known physical format aliases", () => {
    expect(normalizeFormatValue("pro-dub cassette")).toBe("Cassette")
    expect(normalizeFormatValue("clear shell cd-r")).toBe("CD")
    expect(normalizeFormatValue("clear shell tape")).toBe("Cassette")
    expect(normalizeFormatValue('12" vinyl')).toBe("Vinyl")
    expect(normalizeFormatValue("compact cd")).toBe("CD")
  })

  it("returns null for unknown format values", () => {
    expect(normalizeFormatValue("poster")).toBeNull()
    expect(normalizeFormatValue(null)).toBeNull()
  })
})

describe("normalizeSearchHit", () => {
  beforeEach(() => {
    faker.seed(707)
  })

  it("normalizes a rich hit payload and derives stock + format state", () => {
    const normalized = normalizeSearchHit({
      id: faker.string.uuid(),
      handle: "  hidden-history  ",
      title: "Blood Incantation - Hidden History",
      subtitle: "Deluxe Edition",
      thumbnail: "https://cdn.example.com/cover.jpg",
      collection_title: "Season Of Mist",
      metadata: {
        artist: "Blood Incantation",
      },
      genres: ["Death Metal", " "],
      metal_genres: "death, progressive",
      category_handles: ["vinyl", "artists"],
      category_labels: ["Vinyl", "Artists"],
      variant_titles: ["LP", "CD", ""],
      format: "LP",
      price_amount: "2499",
      currency_code: "usd",
      stock_status: "IN_STOCK",
      inventory_quantity: "2",
      default_variant_id: "variant-1",
      createdAt: "2025-01-01T00:00:00.000Z",
      productType: "album",
    })

    expect(normalized.handle).toBe("hidden-history")
    expect(normalized.artist).toBe("Blood Incantation")
    expect(normalized.album).toBe("Hidden History")
    expect(normalized.stockStatus).toBe("low_stock")
    expect(normalized.formats).toEqual(["Vinyl", "CD"])
    expect(normalized.format).toBe("Vinyl")
    expect(normalized.genres).toEqual(["Death Metal", " "])
    expect(normalized.metalGenres).toEqual(["death", "progressive"])
    expect(normalized.defaultVariant).toEqual({
      id: "variant-1",
      title: "Vinyl",
      currency: "usd",
      amount: 2499,
      hasPrice: true,
      inStock: true,
      stockStatus: "low_stock",
      inventoryQuantity: 2,
    })
    expect(normalized.createdAt).toBe("2025-01-01T00:00:00.000Z")
    expect(normalized.productType).toBe("album")
  })

  it("falls back across aliases and string coercions", () => {
    const normalized = normalizeSearchHit({
      product_id: 42,
      handle: " ",
      name: "Nocturnal",
      subTitle: "Single",
      images: [{ url: "https://cdn.example.com/alt.jpg" }],
      collection: "Underground Series",
      metadata: ["invalid"],
      genre: "black,ambient",
      categories: "cassette, underground",
      variants: "mc,tape",
      formats: ["shell"],
      amount: "1399",
      price_currency: "eur",
      in_stock: "false",
      variant_id: "variant-2",
      quantity: "0",
      created_at: "2024-01-01T00:00:00.000Z",
      product_type: "cassette",
    })

    expect(normalized.id).toBe("42")
    expect(normalized.handle).toBe("")
    expect(normalized.title).toBe("Nocturnal")
    expect(normalized.subtitle).toBe("Single")
    expect(normalized.thumbnail).toBe("https://cdn.example.com/alt.jpg")
    expect(normalized.collectionTitle).toBe("Underground Series")
    expect(normalized.artist).toBe("Underground Series")
    expect(normalized.album).toBe("Nocturnal")
    expect(normalized.stockStatus).toBe("sold_out")
    expect(normalized.formats).toEqual(["Cassette"])
    expect(normalized.defaultVariant?.currency).toBe("eur")
    expect(normalized.defaultVariant?.amount).toBe(1399)
    expect(normalized.defaultVariant?.stockStatus).toBe("sold_out")
    expect(normalized.createdAt).toBe("2024-01-01T00:00:00.000Z")
    expect(normalized.productType).toBe("cassette")
  })

  it("uses randomUUID when no id aliases are present", () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("random-id")

    const normalized = normalizeSearchHit({
      handle: "void",
      image: "https://cdn.example.com/image.jpg",
      in_stock: true,
      genres: 99,
      category_labels: ["   "],
      metadata: 99,
    })

    expect(normalized.id).toBe("random-id")
    expect(normalized.title).toBe("Untitled Release")
    expect(normalized.thumbnail).toBe("https://cdn.example.com/image.jpg")
    expect(normalized.stockStatus).toBe("in_stock")
    expect(normalized.defaultVariant).toBeNull()
  })

  it("uses string image arrays when present", () => {
    const normalized = normalizeSearchHit({
      uid: "uid-1",
      handle: "string-image",
      title: "Test",
      images: ["https://cdn.example.com/string-image.jpg"],
    })

    expect(normalized.thumbnail).toBe("https://cdn.example.com/string-image.jpg")
  })

  it("returns a null thumbnail when no image fields are usable", () => {
    const normalized = normalizeSearchHit({
      uid: "uid-2",
      handle: "no-image",
      title: "No image",
      images: [42],
    })

    expect(normalized.thumbnail).toBeNull()
  })

  it("prefers explicit artist, currency alias, and variantId alias", () => {
    const normalized = normalizeSearchHit({
      uid: "uid-artist",
      handle: "explicit-artist",
      title: "Fallback Artist - Album",
      artist: "Explicit Artist",
      category_handles: ["vinyl"],
      variantId: "variant-id-alias",
      amount: 1599,
      currency: "cad",
      in_stock: "true",
      format: "vinyl",
    })

    expect(normalized.artist).toBe("Explicit Artist")
    expect(normalized.defaultVariant?.id).toBe("variant-id-alias")
    expect(normalized.defaultVariant?.currency).toBe("cad")
  })
})

describe("extractFacetMaps", () => {
  it("returns empty facet maps when facet distribution is missing", () => {
    expect(extractFacetMaps(undefined)).toEqual({
      genres: {},
      metalGenres: {},
      format: {},
      categories: {},
      variants: {},
      productTypes: {},
    })
  })

  it("parses facet aliases and ignores invalid counts", () => {
    const facets = extractFacetMaps(
      {
        genre: { black: "3", invalid: "NaN" },
        metal_genres: { death: 2 },
        formats: { LP: "4", poster: "nope" },
        categories: { doom: "5" },
        variants: { CD: "2" },
        productTypes: { album: 6 },
      } as unknown as NonNullable<Parameters<typeof extractFacetMaps>[0]>
    )

    expect(facets).toEqual({
      genres: { black: 3 },
      metalGenres: { death: 2 },
      format: { LP: 4 },
      categories: { doom: 5 },
      variants: { CD: 2 },
      productTypes: { album: 6 },
    })
  })

  it("treats non-object facet entries as empty maps", () => {
    const facets = extractFacetMaps(
      {
        genres: 10,
        format: 20,
        category_handles: 30,
        variant_titles: 40,
        product_type: 50,
      } as unknown as NonNullable<Parameters<typeof extractFacetMaps>[0]>
    )

    expect(facets).toEqual({
      genres: {},
      metalGenres: {},
      format: {},
      categories: {},
      variants: {},
      productTypes: {},
    })
  })
})
