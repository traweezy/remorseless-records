import { describe, expect, it } from "vitest"

import { estimateStandardShippingAmount } from "@/lib/shipping/estimate"

describe("standard shipping estimate", () => {
  it.each([
    [0, 0],
    [1, 5],
    [2, 5.5],
    [3, 6],
  ])("estimates %s item(s) as %s major units", (quantity, expected) => {
    expect(estimateStandardShippingAmount(quantity)).toBe(expected)
  })
})
