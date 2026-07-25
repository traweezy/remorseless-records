import { toStripeMinorUnit } from "./stripe-units"

describe("Stripe monetary units", () => {
  it("converts USD major units to cents", () => {
    expect(toStripeMinorUnit(23, "usd")).toBe(2_300)
    expect(toStripeMinorUnit(5.5, "USD")).toBe(550)
  })

  it("rejects invalid currency and amount inputs", () => {
    expect(() => toStripeMinorUnit(-1, "usd")).toThrow("non-negative")
    expect(() => toStripeMinorUnit(1, "jpy")).toThrow(
      "Unsupported checkout currency"
    )
  })
})
