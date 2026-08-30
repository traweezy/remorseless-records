import type { FrozenTaxQuote } from "./context"
import {
  preservedRateForNewShipping,
  preservedRatesFromTaxLines,
  requirePreservedStripeOrderRates,
} from "./order-rate-preservation"

const identity: FrozenTaxQuote = {
  collectionMode: "collect",
  generation: 3,
  provider: "stripe_tax",
  stripeCalculationId: "taxcalc_original",
}

const taxLine = (rate: number, calculationId = "taxcalc_original") => ({
  code: `rr_tax:stripe_tax:g3:${calculationId}`,
  rate,
})

describe("Stripe Tax order rate preservation", () => {
  it("preserves the exact effective rates on existing order lines", () => {
    expect(
      preservedRatesFromTaxLines(
        {
          items: [
            {
              id: "orli_01",
              tax_lines: [taxLine(4), taxLine(4.75)],
            },
          ],
          shipping_methods: [{ id: "ordsm_01", tax_lines: [taxLine(8.75)] }],
        },
        identity
      )
    ).toEqual({
      itemRates: { orli_01: 8.75 },
      shippingRates: { ordsm_01: 8.75 },
    })
  })

  it.each([
    ["missing tax lines", { id: "orli_01", tax_lines: [] }],
    [
      "another calculation",
      { id: "orli_01", tax_lines: [taxLine(8.75, "taxcalc_other")] },
    ],
    ["an invalid rate", { id: "orli_01", tax_lines: [taxLine(-1)] }],
  ])("rejects an incomplete target with %s", (_label, item) => {
    expect(
      preservedRatesFromTaxLines(
        { items: [item], shipping_methods: [] },
        identity
      )
    ).toBeNull()
  })

  it("uses the reviewed original shipping rate for a new return method", () => {
    expect(
      preservedRateForNewShipping(
        {
          shipping_methods: [
            { id: "ordsm_original", tax_lines: [taxLine(8.75)] },
          ],
        },
        {
          items: [],
          shipping_methods: [
            { id: "ordsm_return_1" },
            { id: "ordsm_return_2" },
          ],
        },
        identity
      )
    ).toEqual({
      ordsm_return_1: 8.75,
      ordsm_return_2: 8.75,
    })
  })

  it("rejects ambiguous original shipping rates", () => {
    expect(
      preservedRateForNewShipping(
        {
          shipping_methods: [
            { id: "ordsm_1", tax_lines: [taxLine(8)] },
            { id: "ordsm_2", tax_lines: [taxLine(8.75)] },
          ],
        },
        { items: [], shipping_methods: [{ id: "ordsm_return" }] },
        identity
      )
    ).toBeNull()
  })

  it("fails closed when an order edit adds an unbound taxable item", () => {
    expect(() =>
      requirePreservedStripeOrderRates(
        {
          items: [{ id: "orli_existing", tax_lines: [taxLine(8.75)] }],
          shipping_methods: [],
        },
        {
          items: [
            { id: "orli_existing", tax_lines: [taxLine(8.75)] },
            { id: "orli_new", tax_lines: [] },
          ],
          shipping_methods: [],
        },
        identity
      )
    ).toThrow(
      "Create a new order so its payment and tax calculation remain bound"
    )
  })

  it("returns reviewed rates for a safe existing-line update", () => {
    expect(
      requirePreservedStripeOrderRates(
        {
          items: [{ id: "orli_01", tax_lines: [taxLine(8.75)] }],
          shipping_methods: [],
        },
        {
          items: [{ id: "orli_01", tax_lines: [taxLine(8.75)] }],
          shipping_methods: [],
        },
        identity
      )
    ).toEqual({
      itemRates: { orli_01: 8.75 },
      shippingRates: {},
    })
  })
})
