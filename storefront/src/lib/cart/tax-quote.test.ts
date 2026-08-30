import { describe, expect, it } from "vitest"

import { TaxQuoteIdentityError, taxQuoteIdentityFromCart } from "./tax-quote"

const fingerprint = "abcdefghijklmnopqrstuvwxyzABCDEFG_0123456789"

const line = ({
  calculationId = "taxcalc_test",
  generation = 2,
  provider = "stripe_tax",
  rate = 8.25,
  collectionMode = "collect",
}: {
  calculationId?: string | null
  generation?: number
  provider?: "stripe_tax" | "taxrate_io"
  rate?: number
  collectionMode?: "collect" | "disabled"
} = {}) => ({
  code:
    collectionMode === "disabled"
      ? `rr_tax:disabled:g${generation}:decision`
      : `rr_tax:${provider}:g${generation}:${calculationId ?? "quote"}`,
  data: {
    ...(collectionMode === "collect" && calculationId
      ? { calculation_id: calculationId }
      : {}),
    collection_mode: collectionMode,
    fingerprint,
    generation,
    ...(collectionMode === "collect" ? { provider } : {}),
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
      collectionMode: "collect",
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
      collectionMode: "collect",
      provider: "taxrate_io",
      taxRatePercent: 7.5,
    })
  })

  it("extracts an explicit disabled collection decision", () => {
    expect(
      taxQuoteIdentityFromCart({
        items: [
          {
            tax_lines: [
              line({
                calculationId: null,
                collectionMode: "disabled",
                generation: 5,
                rate: 0,
              }),
            ],
          },
        ],
      })
    ).toEqual({
      calculationId: null,
      collectionMode: "disabled",
      fingerprint,
      generation: 5,
      provider: null,
      taxRatePercent: null,
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
