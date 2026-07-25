import {
  orderUsesStripe,
  stripeDashboardPaymentUrl,
  stripeOrderDescription,
  stripeOrderMetadata,
  stripePaymentReferencesFromOrder,
  syncStripeOrderReferences,
} from "./order-sync";

describe("Stripe order sync", () => {
  it("extracts and deduplicates official Stripe payment references", () => {
    expect(
      stripePaymentReferencesFromOrder({
        payment_collections: [
          {
            payments: [
              {
                provider_id: "pp_stripe_stripe",
                amount: 24.99,
                currency_code: "USD",
                captured_at: "2026-07-25T00:00:00.000Z",
                data: {
                  id: "pi_valid123",
                  livemode: false,
                  status: "succeeded",
                },
              },
            ],
            payment_sessions: [
              {
                provider_id: "pp_stripe_stripe",
                amount: 24.99,
                data: { id: "pi_valid123", status: "requires_payment_method" },
              },
              {
                provider_id: "pp_system",
                data: { id: "pi_wrong_provider" },
              },
            ],
          },
        ],
      }),
    ).toEqual([
      {
        amount: 24.99,
        currencyCode: "usd",
        livemode: false,
        paymentIntentId: "pi_valid123",
        status: "succeeded",
      },
    ]);
  });

  it("builds non-PII Stripe annotations and mode-safe dashboard links", () => {
    expect(
      stripeOrderMetadata({ orderId: "order_01", orderNumber: "1042" }),
    ).toEqual({
      commerce_platform: "medusa",
      medusa_order_id: "order_01",
      medusa_order_number: "1042",
      storefront: "remorseless-records",
    });
    expect(stripeOrderDescription("1042")).toBe(
      "Remorseless Records order #1042",
    );
    expect(
      stripeDashboardPaymentUrl({
        amount: 24.99,
        currencyCode: "usd",
        livemode: false,
        paymentIntentId: "pi_valid123",
        status: "succeeded",
      }),
    ).toBe("https://dashboard.stripe.com/test/payments/pi_valid123");
  });

  it("rejects malformed and untrusted payment references", () => {
    expect(
      stripePaymentReferencesFromOrder({
        payment_collections: [
          {
            payments: [
              {
                provider_id: "pp_stripe_stripe",
                data: { id: "not-a-payment-intent" },
              },
            ],
          },
        ],
      }),
    ).toEqual([]);
  });

  it("distinguishes non-Stripe orders from malformed Stripe sessions", () => {
    const nonStripeOrder = {
      payment_collections: [
        {
          payment_sessions: [
            { provider_id: "pp_system", data: { id: "system_01" } },
          ],
        },
      ],
    };
    const malformedStripeOrder = {
      payment_collections: [
        {
          payment_sessions: [
            { provider_id: "pp_stripe_stripe", data: { id: "invalid" } },
          ],
        },
      ],
    };

    expect(orderUsesStripe(nonStripeOrder)).toBe(false);
    expect(orderUsesStripe(malformedStripeOrder)).toBe(true);
    expect(stripePaymentReferencesFromOrder(malformedStripeOrder)).toEqual([]);
  });

  it("annotates both the PaymentIntent and an existing Charge", async () => {
    const updatePaymentIntent = jest.fn().mockResolvedValue({
      latest_charge: "ch_valid123",
    });
    const updateCharge = jest.fn().mockResolvedValue({});

    await expect(
      syncStripeOrderReferences({
        client: {
          charges: { update: updateCharge },
          paymentIntents: { update: updatePaymentIntent },
        },
        orderId: "order_01",
        orderNumber: "1042",
        references: [
          {
            amount: 24.99,
            currencyCode: "usd",
            livemode: false,
            paymentIntentId: "pi_valid123",
            status: "succeeded",
          },
        ],
      }),
    ).resolves.toBe(1);

    const annotation = {
      description: "Remorseless Records order #1042",
      metadata: {
        commerce_platform: "medusa",
        medusa_order_id: "order_01",
        medusa_order_number: "1042",
        storefront: "remorseless-records",
      },
    };
    expect(updatePaymentIntent).toHaveBeenCalledWith(
      "pi_valid123",
      annotation,
      {
        idempotencyKey: "rr-order-sync:order_01:pi_valid123:intent:v1",
      },
    );
    expect(updateCharge).toHaveBeenCalledWith("ch_valid123", annotation, {
      idempotencyKey: "rr-order-sync:order_01:pi_valid123:charge:v1",
    });
  });
});
