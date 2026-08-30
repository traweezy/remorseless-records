import type { AdminOrder } from "@medusajs/framework/types"
import { renderToStaticMarkup } from "react-dom/server"

import { StripeOrderPaymentWidget } from "./order-stripe-payment"

const renderWidget = (data: unknown): string =>
  renderToStaticMarkup(<StripeOrderPaymentWidget data={data as AdminOrder} />)

describe("Stripe order payment widget", () => {
  it("links to the exact test-mode PaymentIntent", () => {
    const markup = renderWidget({
      payment_collections: [
        {
          payments: [
            {
              amount: 24.99,
              currency_code: "usd",
              data: {
                id: "pi_valid123",
                livemode: false,
                status: "succeeded",
              },
              provider_id: "pp_stripe_stripe",
            },
          ],
        },
      ],
    })

    expect(markup).toContain("Stripe payments")
    expect(markup).toContain(
      "https://dashboard.stripe.com/test/payments/pi_valid123"
    )
    expect(markup).toContain("Test mode")
  })

  it("surfaces malformed payment data without exposing an unsafe link", () => {
    const markup = renderWidget({ payment_collections: [false] })

    expect(markup).toContain("Stripe payment data unavailable")
    expect(markup).toContain("Open refund guide and audit")
    expect(markup).not.toContain("dashboard.stripe.com")
  })

  it("disables the Stripe link when payment mode is absent", () => {
    const markup = renderWidget({
      payment_collections: [
        {
          payments: [
            {
              data: { id: "pi_valid123", status: "succeeded" },
              provider_id: "pp_stripe_stripe",
            },
          ],
        },
      ],
    })

    expect(markup).toContain("Mode unavailable")
    expect(markup).not.toContain("dashboard.stripe.com")
  })
})
