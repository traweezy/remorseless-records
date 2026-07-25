import { faker } from "@faker-js/faker"
import { beforeEach, describe, expect, it } from "vitest"

import { formatAmount } from "@/lib/money"

describe("formatAmount", () => {
  beforeEach(() => {
    faker.seed(101)
  })

  it("formats major units using Intl currency formatting", () => {
    const amount = faker.number.float({
      min: 10,
      max: 999.99,
      fractionDigits: 2,
    })
    const expected = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount)

    expect(formatAmount("USD", amount)).toBe(expected)
  })

  it("handles zero and negative values", () => {
    expect(formatAmount("USD", 0)).toBe("$0.00")
    expect(formatAmount("USD", -2.5)).toBe("-$2.50")
  })
})
