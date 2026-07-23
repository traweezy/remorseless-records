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
  it("shows low-stock state only for eligible verified counts", () => {
    expect(
      resolveStockChip(
        makeVariant({ stockStatus: "low_stock", inventoryQuantity: 2 })
      )
    ).toMatchObject({ label: "Low stock" })
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
