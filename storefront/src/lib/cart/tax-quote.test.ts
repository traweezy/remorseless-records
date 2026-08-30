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

  it("rejects noncanonical provider code suffixes", () => {
    const taxRateLine = line({
      calculationId: null,
      provider: "taxrate_io",
    })
    const stripeLine = line()

    expect(() =>
      taxQuoteIdentityFromCart({
        items: [
          {
            tax_lines: [
              { ...taxRateLine, code: "rr_tax:taxrate_io:g2:arbitrary" },
            ],
          },
        ],
      })
    ).toThrow(TaxQuoteIdentityError)
    expect(() =>
      taxQuoteIdentityFromCart({
        items: [
          {
            tax_lines: [{ ...stripeLine, code: "rr_tax:stripe_tax:g2:quote" }],
          },
        ],
      })
    ).toThrow(TaxQuoteIdentityError)
  })

  it("rejects mixed primitive and structured tax lines", () => {
    expect(() =>
      taxQuoteIdentityFromCart({
        items: [{ tax_lines: [line(), false] }],
      })
    ).toThrow(TaxQuoteIdentityError)
  })

  it.each([
    ["generation", "generation", true],
    ["rate", "rate", false],
    ["rate above 100%", "rate", 101],
    ["metadata", "data", []],
  ])("rejects coercive %s data", (_label, field, value) => {
    const taxLine = line() as unknown as Record<string, unknown>
    if (field === "generation") {
      taxLine.data = {
        ...(taxLine.data as Record<string, unknown>),
        generation: value,
      }
    } else {
      taxLine[field] = value
    }

    expect(() =>
      taxQuoteIdentityFromCart({ items: [{ tax_lines: [taxLine] }] })
    ).toThrow(TaxQuoteIdentityError)
  })
})
