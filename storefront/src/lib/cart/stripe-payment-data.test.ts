import { describe, expect, it } from "vitest"

import { stripePaymentSessionData } from "./stripe-payment-data"

describe("stripePaymentSessionData", () => {
  it("adds searchable, non-PII Medusa cart references", () => {
    expect(
      stripePaymentSessionData({
        id: "cart_01",
        items: [{ quantity: 2 }, { quantity: 3 }],
      })
    ).toEqual({
      payment_description: "Remorseless Records order",
      metadata: {
        commerce_platform: "medusa",
        item_count: "5",
        medusa_cart_id: "cart_01",
        storefront: "remorseless-records",
      },
    })
  })
})
