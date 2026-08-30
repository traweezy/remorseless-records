import { describe, expect, it } from "vitest"

import { stripePaymentSessionData } from "./stripe-payment-data"

const fingerprint = "abcdefghijklmnopqrstuvwxyzABCDEFG_0123456789"

describe("stripePaymentSessionData", () => {
  it("adds searchable, non-PII Medusa and Stripe Tax references", () => {
    expect(
      stripePaymentSessionData({
        id: "cart_01",
        items: [
          {
            quantity: 2,
            tax_lines: [
              {
                code: "rr_tax:stripe_tax:g3:taxcalc_01",
                data: {
                  calculation_id: "taxcalc_01",
                  fingerprint,
                  generation: 3,
                  provider: "stripe_tax",
                },
                rate: 8,
              },
            ],
          },
          {
            quantity: 3,
            tax_lines: [
              {
                code: "rr_tax:stripe_tax:g3:taxcalc_01",
                data: {
                  calculation_id: "taxcalc_01",
                  fingerprint,
                  generation: 3,
                  provider: "stripe_tax",
                },
                rate: 7.5,
              },
            ],
          },
        ],
      })
    ).toEqual({
      payment_description: "Remorseless Records order",
      metadata: {
        commerce_platform: "medusa",
        item_count: "5",
        medusa_cart_id: "cart_01",
        rr_tax_calculation_id: "taxcalc_01",
        rr_tax_collection_mode: "collect",
        rr_tax_fingerprint: fingerprint,
        rr_tax_generation: "3",
        rr_tax_provider: "stripe_tax",
        storefront: "remorseless-records",
      },
    })
  })

  it("freezes the TaxRate.io rate without a Stripe calculation", () => {
    expect(
      stripePaymentSessionData({
        id: "cart_02",
        items: [
          {
            quantity: 1,
            tax_lines: [
              {
                code: "rr_tax:taxrate_io:g4:quote",
                data: {
                  fingerprint,
                  generation: 4,
                  provider: "taxrate_io",
                },
                rate: 7.125,
              },
            ],
          },
        ],
      })
    ).toMatchObject({
      metadata: {
        rr_tax_collection_mode: "collect",
        rr_tax_fingerprint: fingerprint,
        rr_tax_generation: "4",
        rr_tax_provider: "taxrate_io",
        rr_tax_rate_percent: "7.125",
      },
    })
  })

  it("records disabled collection without provider or rate metadata", () => {
    expect(
      stripePaymentSessionData({
        id: "cart_03",
        items: [
          {
            quantity: 1,
            tax_lines: [
              {
                code: "rr_tax:disabled:g5:decision",
                data: {
                  collection_mode: "disabled",
                  fingerprint,
                  generation: 5,
                },
                rate: 0,
              },
            ],
          },
        ],
      })
    ).toMatchObject({
      metadata: {
        rr_tax_collection_mode: "disabled",
        rr_tax_fingerprint: fingerprint,
        rr_tax_generation: "5",
      },
    })
  })

  it.each([
    ["unsafe cart identity", { id: "unsafe/cart", items: [] }],
    ["coercive item quantity", { id: "cart_04", items: [{ quantity: false }] }],
    ["primitive item row", { id: "cart_04", items: [false] }],
  ])("rejects an %s", (_label, cart) => {
    expect(() => stripePaymentSessionData(cart as never)).toThrow()
  })
})
