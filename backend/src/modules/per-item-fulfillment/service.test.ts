import {
  calculatePerItemShippingAmount,
  resolveShippingAmount,
} from "./service"

describe("per-item fulfillment major-unit amounts", () => {
  it("preserves two-decimal shipping configuration", () => {
    expect(resolveShippingAmount(0.5, 1)).toBe(0.5)
    expect(resolveShippingAmount("5.25", 1)).toBe(5.25)
    expect(resolveShippingAmount("invalid", 5)).toBe(5)
  })

  it("calculates shipping in major units without floating-point residue", () => {
    expect(
      calculatePerItemShippingAmount({
        additionalAmount: 0.5,
        baseAmount: 5,
        itemCount: 3,
      })
    ).toBe(6)
    expect(
      calculatePerItemShippingAmount({
        additionalAmount: 0.1,
        baseAmount: 5.1,
        itemCount: 3,
      })
    ).toBe(5.3)
  })

  it("returns zero when the cart has no physical quantity", () => {
    expect(
      calculatePerItemShippingAmount({
        additionalAmount: 0.5,
        baseAmount: 5,
        itemCount: 0,
      })
    ).toBe(0)
  })
})
