import { faker } from "@faker-js/faker"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ProductSearchResponse } from "@/lib/search/search"
import type { ProductSearchHit, VariantOption } from "@/types/product"

import { getProductByHandle } from "@/lib/data/products"
import { mapStoreProductToSearchHit } from "@/lib/products/transformers"
import { enrichSearchResponse } from "@/lib/search/enrich"

vi.mock("@/lib/data/products", () => ({
  getProductByHandle: vi.fn(),
}))

vi.mock("@/lib/products/transformers", () => ({
  mapStoreProductToSearchHit: vi.fn(),
}))

const mockedGetProductByHandle = vi.mocked(getProductByHandle)
const mockedMapStoreProductToSearchHit = vi.mocked(mapStoreProductToSearchHit)

const makeSlug = (value: string) => ({
  artist: value,
  album: value,
  artistSlug: value.toLowerCase(),
  albumSlug: value.toLowerCase(),
})

const makeVariant = (
  overrides: Partial<VariantOption> = {}
): VariantOption => ({
  id: faker.string.uuid(),
  title: "Variant",
  currency: "usd",
  amount: 1999,
  hasPrice: true,
  inStock: true,
  stockStatus: "in_stock",
  inventoryQuantity: 10,
  ...overrides,
})

const makeHit = (overrides: Partial<ProductSearchHit> = {}): ProductSearchHit => {
  const token = faker.string.alphanumeric(8).toLowerCase()
  return {
    id: faker.string.uuid(),
    handle: `${token}-handle`,
    title: `${token}-title`,
    artist: `${token}-artist`,
    album: `${token}-album`,
    slug: makeSlug(token),
    subtitle: null,
    thumbnail: null,
    collectionTitle: "Collection",
    defaultVariant: makeVariant(),
    formats: ["CD"],
    genres: ["Death Metal"],
    metalGenres: ["Death"],
    categories: ["Music"],
    categoryHandles: ["music"],
    variantTitles: ["CD"],
    format: "CD",
    priceAmount: 1999,
    createdAt: "2025-01-01T00:00:00.000Z",
    stockStatus: "in_stock",
    productType: "album",
    ...overrides,
  }
}

const makeResponse = (hits: ProductSearchHit[]): ProductSearchResponse => ({
  hits,
  total: hits.length,
  offset: 0,
  facets: {
    genres: {},
    metalGenres: {},
    format: {},
    categories: {},
    variants: {},
    productTypes: {},
  },
})

describe("enrichSearchResponse", () => {
  beforeEach(() => {
    faker.seed(808)
    mockedGetProductByHandle.mockReset()
    mockedMapStoreProductToSearchHit.mockReset()
  })

  it("returns the same response when no hits require hydration", async () => {
    const response = makeResponse([makeHit()])

    const result = await enrichSearchResponse(response)

    expect(result).toBe(response)
    expect(mockedGetProductByHandle).not.toHaveBeenCalled()
  })

  it("hydrates missing fields once per normalized handle and merges fallback fields", async () => {
    const incomplete = makeHit({
      handle: "  Relic  ",
      formats: [],
      defaultVariant: null,
      collectionTitle: "",
      genres: [],
      metalGenres: [],
      categories: [],
      categoryHandles: [],
      variantTitles: [],
      format: null,
      priceAmount: null,
      stockStatus: "unknown",
    })

    const preserveStatus = makeHit({
      handle: "RELIC",
      formats: [],
      defaultVariant: null,
      collectionTitle: "",
      genres: [],
      metalGenres: [],
      categories: [],
      categoryHandles: [],
      variantTitles: [],
      format: null,
      priceAmount: null,
      stockStatus: "sold_out",
    })

    const fallback = makeHit({
      handle: "relic",
      formats: ["Cassette"],
      defaultVariant: makeVariant({
        title: "Cassette",
        inventoryQuantity: 5,
        stockStatus: "low_stock",
      }),
      collectionTitle: "Vault Collection",
      genres: ["Doom Metal"],
      metalGenres: ["Doom"],
      categories: ["Doom"],
      categoryHandles: ["doom"],
      variantTitles: ["MC"],
      format: "Cassette",
      priceAmount: 2499,
      stockStatus: "in_stock",
    })

    mockedGetProductByHandle
      .mockResolvedValueOnce({
        id: "product-1",
      } as never)
      .mockResolvedValueOnce(null)
    mockedMapStoreProductToSearchHit.mockReturnValue(fallback)

    const unmatched = makeHit({
      handle: "other-release",
      formats: [],
      defaultVariant: null,
      collectionTitle: "",
      genres: [],
      metalGenres: [],
      categories: [],
      categoryHandles: [],
      variantTitles: [],
      format: null,
      priceAmount: null,
      stockStatus: "unknown",
    })

    const emptyHandle = makeHit({
      handle: "   ",
      formats: [],
      defaultVariant: null,
      collectionTitle: "",
      genres: [],
      metalGenres: [],
      categories: [],
      categoryHandles: [],
      variantTitles: [],
      format: null,
      priceAmount: null,
      stockStatus: "unknown",
    })

    const response = makeResponse([incomplete, preserveStatus, unmatched, emptyHandle])
    const result = await enrichSearchResponse(response)

    expect(mockedGetProductByHandle).toHaveBeenCalledTimes(2)
    expect(mockedGetProductByHandle).toHaveBeenNthCalledWith(1, "relic")
    expect(mockedGetProductByHandle).toHaveBeenNthCalledWith(2, "other-release")
    expect(mockedMapStoreProductToSearchHit).toHaveBeenCalledTimes(1)

    const first = result.hits[0]
    const second = result.hits[1]
    const third = result.hits[2]
    const fourth = result.hits[3]

    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect(third).toBeDefined()
    expect(fourth).toBeDefined()

    expect(first).toMatchObject({
      formats: ["Cassette"],
      collectionTitle: "Vault Collection",
      genres: ["Doom Metal"],
      metalGenres: ["Doom"],
      categories: ["Doom"],
      categoryHandles: ["doom"],
      variantTitles: ["MC"],
      format: "Cassette",
      priceAmount: 2499,
      stockStatus: "in_stock",
    })

    expect(second?.stockStatus).toBe("sold_out")
    expect(third).toBe(unmatched)
    expect(fourth).toBe(emptyHandle)
    expect(first?.title).toBe(incomplete.title)
  })

  it("returns the same response when hydration lookups produce no fallback hits", async () => {
    const response = makeResponse([
      makeHit({
        formats: [],
        defaultVariant: null,
        collectionTitle: "",
        genres: [],
        metalGenres: [],
        stockStatus: "unknown",
      }),
    ])

    mockedGetProductByHandle.mockResolvedValue(null)

    const result = await enrichSearchResponse(response)

    expect(result).toBe(response)
    expect(mockedMapStoreProductToSearchHit).not.toHaveBeenCalled()
  })

  it("preserves populated original fields when fallback data exists", async () => {
    const original = makeHit({
      handle: "preserve-me",
      formats: ["Vinyl"],
      defaultVariant: makeVariant({
        inventoryQuantity: null,
        stockStatus: "unknown",
      }),
      collectionTitle: "Original Collection",
      genres: ["Original Genre"],
      metalGenres: ["Original Metal"],
      categories: ["Original Category"],
      categoryHandles: ["original-category"],
      variantTitles: ["Original Variant"],
      format: "Vinyl",
      priceAmount: 1111,
      stockStatus: "sold_out",
    })

    const fallback = makeHit({
      handle: "preserve-me",
      formats: ["Cassette"],
      defaultVariant: makeVariant({
        title: "Cassette",
      }),
      collectionTitle: "Fallback Collection",
      genres: ["Fallback Genre"],
      metalGenres: ["Fallback Metal"],
      categories: ["Fallback Category"],
      categoryHandles: ["fallback-category"],
      variantTitles: ["Fallback Variant"],
      format: "Cassette",
      priceAmount: 2222,
      stockStatus: "in_stock",
    })

    mockedGetProductByHandle.mockResolvedValue({
      id: "preserve-product",
    } as never)
    mockedMapStoreProductToSearchHit.mockReturnValue(fallback)

    const result = await enrichSearchResponse(makeResponse([original]))
    expect(result.hits[0]).toMatchObject({
      formats: ["Vinyl"],
      collectionTitle: "Original Collection",
      genres: ["Original Genre"],
      metalGenres: ["Original Metal"],
      categories: ["Original Category"],
      categoryHandles: ["original-category"],
      variantTitles: ["Original Variant"],
      format: "Vinyl",
      priceAmount: 1111,
      stockStatus: "sold_out",
    })
  })
})
