import { describe, expect, it } from "vitest"

import { resolveStockChip } from "@/lib/products/stock-presentation"
import type { VariantOption } from "@/types/product"

const makeVariant = (
  overrides: Partial<VariantOption> = {}
): VariantOption => ({
  id: "variant-1",
  title: "LP",
  currency: "usd",
  amount: 2_000,
  hasPrice: true,
  inStock: true,
  stockStatus: "in_stock",
  inventoryQuantity: 20,
  ...overrides,
})

describe("resolveStockChip", () => {
  it.each([
    [1, "Only 1 left"],
    [2, "Only 2 left"],
    [5, "Only 5 left"],
  ])(
    "shows the exact eligible low-stock count for %i item(s)",
    (count, label) => {
      expect(
        resolveStockChip(
          makeVariant({ stockStatus: "low_stock", inventoryQuantity: count })
        )
      ).toMatchObject({ label })
    }
  )

  it("omits ineligible low-stock estimates", () => {
    expect(
      resolveStockChip(
        makeVariant({
          stockStatus: "low_stock",
          inventoryQuantity: 2,
          lowStockBadgeEligible: false,
        })
      )
    ).toBeNull()
  })

  it("uses a generic label when a low-stock count is unavailable", () => {
    expect(
      resolveStockChip(
        makeVariant({
          stockStatus: "low_stock",
          inventoryQuantity: null,
        })
      )
    ).toMatchObject({ label: "Low stock" })
  })

  it("labels sold-out and unpriced variants", () => {
    expect(
      resolveStockChip(makeVariant({ inStock: false, stockStatus: "sold_out" }))
    ).toMatchObject({ label: "Sold out" })
    expect(resolveStockChip(makeVariant({ hasPrice: false }))).toMatchObject({
      label: "Unavailable",
    })
  })

  it("omits the chip for normally stocked variants", () => {
    expect(resolveStockChip(makeVariant())).toBeNull()
  })
})
