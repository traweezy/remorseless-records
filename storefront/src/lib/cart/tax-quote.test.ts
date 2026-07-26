import { describe, expect, it } from "vitest"

import { TaxQuoteIdentityError, taxQuoteIdentityFromCart } from "./tax-quote"

const fingerprint = "abcdefghijklmnopqrstuvwxyzABCDEFG_0123456789"

const line = ({
  calculationId = "taxcalc_test",
  generation = 2,
  provider = "stripe_tax",
  rate = 8.25,
}: {
  calculationId?: string | null
  generation?: number
  provider?: "stripe_tax" | "taxrate_io"
  rate?: number
} = {}) => ({
  code: `rr_tax:${provider}:g${generation}:${calculationId ?? "quote"}`,
  data: {
    ...(calculationId ? { calculation_id: calculationId } : {}),
    fingerprint,
    generation,
    provider,
  },
  rate,
})

describe("taxQuoteIdentityFromCart", () => {
  it("extracts Stripe and TaxRate.io identities", () => {
    expect(
      taxQuoteIdentityFromCart({
        items: [{ tax_lines: [line()] }],
      })
    ).toMatchObject({
      calculationId: "taxcalc_test",
      fingerprint,
      generation: 2,
      provider: "stripe_tax",
    })

    expect(
      taxQuoteIdentityFromCart({
        items: [
          {
            tax_lines: [
              line({
                calculationId: null,
                provider: "taxrate_io",
                rate: 7.5,
              }),
            ],
          },
        ],
      })
    ).toMatchObject({
      calculationId: null,
      provider: "taxrate_io",
      taxRatePercent: 7.5,
    })
  })

  it("rejects missing and mixed quote identities", () => {
    expect(() =>
      taxQuoteIdentityFromCart({ items: [{ tax_lines: [] }] })
    ).toThrow(TaxQuoteIdentityError)

    expect(() =>
      taxQuoteIdentityFromCart({
        items: [{ tax_lines: [line()] }],
        shipping_methods: [{ tax_lines: [line({ generation: 3 })] }],
      })
    ).toThrow(TaxQuoteIdentityError)
  })
})
