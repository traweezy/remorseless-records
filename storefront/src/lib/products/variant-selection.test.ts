import { describe, expect, it } from "vitest"

import { resolveDefaultVariantId } from "@/lib/products/variant-selection"
import type { VariantOption } from "@/types/product"

const buildVariant = (
  id: string,
  overrides: Partial<VariantOption> = {}
): VariantOption => ({
  id,
  title: id,
  currency: "usd",
  amount: 1_000,
  hasPrice: true,
  inStock: true,
  stockStatus: "in_stock",
  inventoryQuantity: 10,
  ...overrides,
})

describe("resolveDefaultVariantId", () => {
  it("prefers the first purchasable variant", () => {
    const variants = [
      buildVariant("sold-out", {
        inStock: false,
        stockStatus: "sold_out",
      }),
      buildVariant("available"),
    ]

    expect(resolveDefaultVariantId(variants)).toBe("available")
  })

  it("falls back to the first priced variant", () => {
    const variants = [
      buildVariant("unpriced", {
        amount: 0,
        hasPrice: false,
      }),
      buildVariant("priced", {
        inStock: false,
        stockStatus: "sold_out",
      }),
    ]

    expect(resolveDefaultVariantId(variants)).toBe("priced")
  })

  it("falls back to the first variant when none are priced", () => {
    const variants = [
      buildVariant("first", {
        amount: 0,
        hasPrice: false,
        inStock: false,
        stockStatus: "unknown",
      }),
    ]

    expect(resolveDefaultVariantId(variants)).toBe("first")
    expect(resolveDefaultVariantId([])).toBe("")
  })
})
