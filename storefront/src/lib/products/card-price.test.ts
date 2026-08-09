import { describe, expect, it } from "vitest"

import { resolveProductCardPrice } from "@/lib/products/card-price"
import type { VariantOption } from "@/types/product"

const variant = (
  id: string,
  amount: number,
  inStock = true
): VariantOption => ({
  amount,
  currency: "usd",
  hasPrice: true,
  id,
  inStock,
  inventoryQuantity: inStock ? 10 : 0,
  stockStatus: inStock ? "in_stock" : "sold_out",
  title: id,
})

describe("resolveProductCardPrice", () => {
  it("renders the purchasable range and excludes sold-out variants", () => {
    expect(
      resolveProductCardPrice({
        currency: "usd",
        indexedMax: null,
        indexedMin: null,
        stockStatus: "in_stock",
        variants: [
          variant("LP", 25),
          variant("CD", 12, false),
          variant("Cassette", 18),
        ],
      })
    ).toMatchObject({ label: "$18.00–$25.00", min: 18, max: 25 })
  })

  it("uses indexed ranges for search results", () => {
    expect(
      resolveProductCardPrice({
        currency: "usd",
        indexedMax: 25,
        indexedMin: 18,
        stockStatus: "low_stock",
        variants: [],
      })
    ).toMatchObject({ label: "$18.00–$25.00" })
  })

  it("hides every price for a sold-out product", () => {
    expect(
      resolveProductCardPrice({
        currency: "usd",
        indexedMax: 25,
        indexedMin: 18,
        stockStatus: "sold_out",
        variants: [variant("LP", 25, false)],
      })
    ).toBeNull()
  })
})
