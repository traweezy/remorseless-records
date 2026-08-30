import { formatCurrencyAmount } from "./currency"

describe("notification currency formatting", () => {
  it("rounds high-precision commerce amounts at the currency boundary", () => {
    expect(formatCurrencyAmount({ value: "6.5325" }, "usd")).toBe("$6.53")
    expect(formatCurrencyAmount(1, "USD")).toBe("$1.00")
  })

  it.each([
    ["not-an-amount", "usd"],
    ["", "usd"],
    [-1, "usd"],
    [null, "usd"],
    [true, "usd"],
    [1, "not-a-currency"],
    [1, null],
  ])("rejects invalid amount/currency input", (amount, currency) => {
    expect(formatCurrencyAmount(amount, currency)).toBeNull()
  })
})
