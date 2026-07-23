import { faker } from "@faker-js/faker"
import type { HttpTypes } from "@medusajs/types"
import { beforeEach, describe, expect, it } from "vitest"

import {
  deriveVariantOptions,
  mapStoreProductToRelatedSummary,
  mapStoreProductToSearchHit,
} from "@/lib/products/transformers"

type StoreProduct = HttpTypes.StoreProduct

const makeProduct = (overrides: Partial<StoreProduct> = {}): StoreProduct =>
  ({
    id: faker.string.uuid(),
    handle: "portal-avow",
    title: "Portal - Avow",
    subtitle: "Death Metal",
    thumbnail: "https://cdn.example.com/cover.jpg",
    collection: { title: "Profound Lore" },
    created_at: "2025-01-01T00:00:00.000Z",
    categories: [
      { handle: "genres", name: "Genres" },
      {
        handle: "death",
        name: "Death Metal",
        parent_category: { handle: "genres" },
      },
      { handle: "music", name: "Music" },
      { handle: "vinyl", name: "Vinyl", parent_category: { handle: "music" } },
    ],
    options: [
      {
        title: "Format",
        values: [{ value: "LP" }, { value: "CD" }],
      },
    ],
    variants: [
      {
        id: "variant_lp",
        title: "LP",
        calculated_price: {
          calculated_amount: 2999,
          currency_code: "usd",
        },
        inventory_quantity: 3,
        manage_inventory: true,
        allow_backorder: false,
      },
      {
        id: "variant_cd",
        title: "CD",
        calculated_price: {
          calculated_amount: 1599,
          currency_code: "usd",
        },
        inventory_quantity: 20,
        manage_inventory: true,
        allow_backorder: false,
      },
    ],
    metadata: {
      format: "vinyl",
      product_type: "album",
    },
    ...overrides,
  }) as StoreProduct

describe("product transformers", () => {
  beforeEach(() => {
    faker.seed(333)
  })

  it("derives canonical variant options", () => {
    const variants = deriveVariantOptions(makeProduct().variants)
    expect(variants).toHaveLength(2)
    expect(variants[0]).toMatchObject({
      id: "variant_lp",
      hasPrice: true,
      stockStatus: "low_stock",
      inventoryQuantity: 3,
    })
  })

  it("marks imported low-stock placeholders as ineligible for badges", () => {
    const product = makeProduct({
      variants: [
        {
          id: "variant_seeded",
          title: "CD",
          calculated_price: {
            calculated_amount: 1_200,
            currency_code: "usd",
          },
          inventory_quantity: 2,
          manage_inventory: true,
          metadata: {
            source_low_inventory: true,
            seed_inventory_quantity: 2,
          },
        },
      ] as unknown as StoreProduct["variants"],
    })

    expect(deriveVariantOptions(product.variants)[0]).toMatchObject({
      stockStatus: "low_stock",
      lowStockBadgeEligible: false,
    })
  })

  it("maps product to related summary", () => {
    const summary = mapStoreProductToRelatedSummary(makeProduct())
    expect(summary).toMatchObject({
      handle: "portal-avow",
      title: "Portal - Avow",
      artist: "Portal",
      album: "Avow",
      collectionTitle: "Profound Lore",
    })
    expect(summary.defaultVariant?.id).toBe("variant_lp")
    expect(summary.formats).toContain("Vinyl")
  })

  it("maps product to enriched search hit", () => {
    const hit = mapStoreProductToSearchHit(makeProduct())
    expect(hit.format).toBe("Vinyl")
    expect(hit.genres).toContain("Death Metal")
    expect(hit.metalGenres).toContain("Death Metal")
    expect(hit.categoryHandles).toContain("death")
    expect(hit.productType).toBe("album")
    expect(hit.stockStatus).toBe("low_stock")
    expect(hit.priceMin).toBe(1_599)
    expect(hit.priceMax).toBe(2_999)
  })

  it("handles sparse products without variants", () => {
    const product = makeProduct({
      variants: [],
      options: [],
      categories: [],
      metadata: null,
      handle: "minimal",
      title: "Minimal",
      subtitle: "",
    })
    const summary = mapStoreProductToRelatedSummary(product)
    const hit = mapStoreProductToSearchHit(product)

    expect(summary.defaultVariant).toBeNull()
    expect(summary.formats).toEqual([])
    expect(hit.priceAmount).toBeNull()
  })
})
