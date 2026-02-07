import { faker } from "@faker-js/faker"
import { beforeEach, describe, expect, it } from "vitest"

import {
  LOW_STOCK_THRESHOLD,
  resolveVariantStockStatus,
  summarizeStockStatus,
} from "@/lib/products/stock"

describe("resolveVariantStockStatus", () => {
  beforeEach(() => {
    faker.seed(202)
  })

  it("uses explicit inventory quantity when present", () => {
    expect(resolveVariantStockStatus({ inventoryQuantity: 0 })).toEqual({
      status: "sold_out",
      inStock: false,
    })

    expect(resolveVariantStockStatus({ inventoryQuantity: LOW_STOCK_THRESHOLD })).toEqual({
      status: "low_stock",
      inStock: true,
    })

    expect(resolveVariantStockStatus({ inventoryQuantity: LOW_STOCK_THRESHOLD + 1 })).toEqual({
      status: "in_stock",
      inStock: true,
    })
  })

  it("normalizes stock status aliases when quantity is unavailable", () => {
    expect(resolveVariantStockStatus({ stockStatus: "out-of-stock" })).toEqual({
      status: "sold_out",
      inStock: false,
    })

    expect(resolveVariantStockStatus({ stockStatus: "Scarce" })).toEqual({
      status: "low_stock",
      inStock: true,
    })

    expect(resolveVariantStockStatus({ stockStatus: "backorder" })).toEqual({
      status: "in_stock",
      inStock: true,
    })
  })

  it("falls back to inventory flags before unknown", () => {
    expect(
      resolveVariantStockStatus({
        inventoryQuantity: Number.NaN,
        allowBackorder: true,
      })
    ).toEqual({
      status: "in_stock",
      inStock: true,
    })

    expect(resolveVariantStockStatus({ manageInventory: false })).toEqual({
      status: "in_stock",
      inStock: true,
    })

    expect(resolveVariantStockStatus({})).toEqual({
      status: "unknown",
      inStock: true,
    })
  })

  it("treats unrecognized stock status values as unknown", () => {
    expect(resolveVariantStockStatus({ stockStatus: "mystery" })).toEqual({
      status: "unknown",
      inStock: true,
    })
  })
})

describe("summarizeStockStatus", () => {
  beforeEach(() => {
    faker.seed(303)
  })

  it("returns unknown when no variants are provided", () => {
    expect(summarizeStockStatus([])).toBe("unknown")
  })

  it("returns sold_out when every known status is sold out", () => {
    expect(
      summarizeStockStatus([
        { stockStatus: "sold_out" },
        { inStock: false },
        { stockStatus: "sold_out" },
      ])
    ).toBe("sold_out")
  })

  it("returns low_stock when at least one available variant is low", () => {
    expect(
      summarizeStockStatus([
        { stockStatus: "in_stock" },
        { stockStatus: "low_stock" },
        { inStock: false },
      ])
    ).toBe("low_stock")
  })

  it("returns in_stock when only in-stock availability remains", () => {
    const variantCount = faker.number.int({ min: 2, max: 5 })
    const variants = Array.from({ length: variantCount }, (_, index) =>
      index % 2 === 0 ? { stockStatus: "in_stock" as const } : { inStock: true }
    )

    expect(summarizeStockStatus(variants)).toBe("in_stock")
  })

  it("ignores unknown entries when they are the only statuses", () => {
    expect(
      summarizeStockStatus([{ stockStatus: "unknown" }, { stockStatus: "unknown" }])
    ).toBe("unknown")
  })
})
