import { faker } from "@faker-js/faker"
import { beforeEach, describe, expect, it } from "vitest"

import { formatAmount } from "@/lib/money"

describe("formatAmount", () => {
  beforeEach(() => {
    faker.seed(101)
  })

  it("formats cents using Intl currency formatting", () => {
    const cents = faker.number.int({ min: 1_000, max: 99_999 })
    const expected = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100)

    expect(formatAmount("USD", cents)).toBe(expected)
  })

  it("handles zero and negative values", () => {
    expect(formatAmount("USD", 0)).toBe("$0.00")
    expect(formatAmount("USD", -250)).toBe("-$2.50")
  })
})
