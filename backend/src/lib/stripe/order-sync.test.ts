import {
  inspectStripePaymentReferencesFromOrder,
  orderUsesStripe,
  stripeDashboardPaymentUrl,
  stripeOrderDescription,
  stripeOrderMetadata,
  stripePaymentReferencesFromOrder,
  StripeOrderSyncError,
  syncStripeOrderReferences,
} from "./order-sync"

const orderAnnotation = {
  description: "Remorseless Records order #1042",
  metadata: {
    commerce_platform: "medusa",
    medusa_order_id: "order_01",
    medusa_order_number: "1042",
    storefront: "remorseless-records",
  },
}

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
      })
    ).toEqual([
      {
        amount: 24.99,
        currencyCode: "usd",
        livemode: false,
        paymentIntentId: "pi_valid123",
        status: "succeeded",
      },
    ])
  })

  it("builds non-PII Stripe annotations and mode-safe dashboard links", () => {
    expect(
      stripeOrderMetadata({ orderId: "order_01", orderNumber: "1042" })
    ).toEqual({
      commerce_platform: "medusa",
      medusa_order_id: "order_01",
      medusa_order_number: "1042",
      storefront: "remorseless-records",
    })
    expect(stripeOrderDescription("1042")).toBe(
      "Remorseless Records order #1042"
    )
    expect(
      stripeDashboardPaymentUrl({
        amount: 24.99,
        currencyCode: "usd",
        livemode: false,
        paymentIntentId: "pi_valid123",
        status: "succeeded",
      })
    ).toBe("https://dashboard.stripe.com/test/payments/pi_valid123")
    expect(
      stripeDashboardPaymentUrl({
        amount: null,
        currencyCode: null,
        livemode: null,
        paymentIntentId: "pi_valid123",
        status: null,
      })
    ).toBeNull()
  })

  it("rejects malformed Stripe payment references", () => {
    expect(() =>
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
      })
    ).toThrow("Stripe order payment projection is malformed")
  })

  it("distinguishes non-Stripe orders from malformed Stripe sessions", () => {
    const nonStripeOrder = {
      payment_collections: [
        {
          payment_sessions: [
            { provider_id: "pp_system", data: { id: "system_01" } },
          ],
        },
      ],
    }
    const malformedStripeOrder = {
      payment_collections: [
        {
          payment_sessions: [
            { provider_id: "pp_stripe_stripe", data: { id: "invalid" } },
          ],
        },
      ],
    }

    expect(orderUsesStripe(nonStripeOrder)).toBe(false)
    expect(orderUsesStripe(malformedStripeOrder)).toBe(true)
    expect(() =>
      stripePaymentReferencesFromOrder(malformedStripeOrder)
    ).toThrow("Stripe order payment projection is malformed")
    expect(
      inspectStripePaymentReferencesFromOrder(malformedStripeOrder)
    ).toEqual({ available: false, references: [] })
  })

  it.each([
    ["primitive payment collection", { payment_collections: [false] }],
    ["primitive payment row", { payment_collections: [{ payments: [false] }] }],
    [
      "coercive payment amount",
      {
        payment_collections: [
          {
            payments: [
              {
                amount: true,
                data: { id: "pi_valid123", livemode: false },
                provider_id: "pp_stripe_stripe",
              },
            ],
          },
        ],
      },
    ],
    [
      "coercive livemode",
      {
        payment_collections: [
          {
            payments: [
              {
                data: { id: "pi_valid123", livemode: "false" },
                provider_id: "pp_stripe_stripe",
              },
            ],
          },
        ],
      },
    ],
    [
      "overlong payment status",
      {
        payment_collections: [
          {
            payments: [
              {
                data: {
                  id: "pi_valid123",
                  livemode: false,
                  status: "s".repeat(65),
                },
                provider_id: "pp_stripe_stripe",
              },
            ],
          },
        ],
      },
    ],
  ])("rejects a %s", (_label, order) => {
    expect(() => stripePaymentReferencesFromOrder(order)).toThrow(
      "Stripe order payment projection is malformed"
    )
  })

  it("rejects conflicting duplicate PaymentIntent projections", () => {
    expect(() =>
      stripePaymentReferencesFromOrder({
        payment_collections: [
          {
            payments: [
              {
                amount: 25,
                data: { id: "pi_valid123", livemode: false },
                provider_id: "pp_stripe_stripe",
              },
            ],
            payment_sessions: [
              {
                amount: 26,
                data: { id: "pi_valid123", livemode: false },
                provider_id: "pp_stripe_stripe",
              },
            ],
          },
        ],
      })
    ).toThrow("Stripe order payment projection is malformed")
  })

  it("annotates both the PaymentIntent and an existing Charge", async () => {
    const updatePaymentIntent = jest.fn().mockResolvedValue({
      ...orderAnnotation,
      id: "pi_valid123",
      latest_charge: "ch_valid123",
      object: "payment_intent",
    })
    const updateCharge = jest.fn().mockResolvedValue({
      ...orderAnnotation,
      id: "ch_valid123",
      object: "charge",
    })

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
      })
    ).resolves.toBe(1)

    expect(updatePaymentIntent).toHaveBeenCalledWith(
      "pi_valid123",
      orderAnnotation,
      expect.objectContaining({
        idempotencyKey: "rr-order-sync:order_01:pi_valid123:intent:v1",
        maxNetworkRetries: 0,
        timeout: expect.any(Number),
      })
    )
    expect(updateCharge).toHaveBeenCalledWith(
      "ch_valid123",
      orderAnnotation,
      expect.objectContaining({
        idempotencyKey: "rr-order-sync:order_01:pi_valid123:charge:v1",
        maxNetworkRetries: 0,
        timeout: expect.any(Number),
      })
    )
  })

  it.each([
    [
      "PaymentIntent",
      {
        charges: { update: jest.fn() },
        paymentIntents: { update: jest.fn().mockResolvedValue(false) },
      },
    ],
    [
      "PaymentIntent charge projection",
      {
        charges: { update: jest.fn() },
        paymentIntents: {
          update: jest.fn().mockResolvedValue({
            ...orderAnnotation,
            id: "pi_valid123",
            object: "payment_intent",
          }),
        },
      },
    ],
    [
      "Charge",
      {
        charges: { update: jest.fn().mockResolvedValue(false) },
        paymentIntents: {
          update: jest.fn().mockResolvedValue({
            ...orderAnnotation,
            id: "pi_valid123",
            latest_charge: "ch_valid123",
            object: "payment_intent",
          }),
        },
      },
    ],
  ])(
    "rejects a malformed %s update acknowledgement",
    async (_label, client) => {
      await expect(
        syncStripeOrderReferences({
          client,
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
        })
      ).rejects.toThrow("Stripe order sync acknowledgement is invalid")
    }
  )

  it("rejects invalid sync input before contacting Stripe", async () => {
    const update = jest.fn()
    await expect(
      syncStripeOrderReferences({
        client: {
          charges: { update },
          paymentIntents: { update },
        },
        orderId: "unsafe/order",
        orderNumber: "0",
        references: [],
      })
    ).rejects.toThrow("Stripe order sync input is invalid")
    await expect(
      syncStripeOrderReferences({
        client: {
          charges: { update },
          paymentIntents: { update },
        },
        orderId: `order_${"a".repeat(120)}`,
        orderNumber: "1",
        references: [
          {
            amount: null,
            currencyCode: null,
            livemode: null,
            paymentIntentId: `pi_${"b".repeat(120)}`,
            status: null,
          },
        ],
      })
    ).rejects.toThrow("Stripe order sync input is invalid")
    expect(update).not.toHaveBeenCalled()
  })

  it("retries one transient update with the same idempotency key", async () => {
    const updatePaymentIntent = jest
      .fn()
      .mockRejectedValueOnce({
        statusCode: 503,
        headers: { "stripe-should-retry": "true" },
      })
      .mockResolvedValue({
        ...orderAnnotation,
        id: "pi_valid123",
        latest_charge: null,
        object: "payment_intent",
      })
    const onRetry = jest.fn()

    await expect(
      syncStripeOrderReferences({
        client: {
          charges: { update: jest.fn() },
          paymentIntents: { update: updatePaymentIntent },
        },
        onRetry,
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
      })
    ).resolves.toBe(1)

    expect(updatePaymentIntent).toHaveBeenCalledTimes(2)
    const firstOptions = updatePaymentIntent.mock.calls[0]?.[2]
    const secondOptions = updatePaymentIntent.mock.calls[1]?.[2]
    expect(firstOptions).toEqual(
      expect.objectContaining({
        idempotencyKey: "rr-order-sync:order_01:pi_valid123:intent:v1",
        maxNetworkRetries: 0,
      })
    )
    expect(secondOptions).toEqual(
      expect.objectContaining({
        idempotencyKey: firstOptions?.idempotencyKey,
        maxNetworkRetries: 0,
      })
    )
    expect(secondOptions?.timeout).toBeLessThanOrEqual(firstOptions?.timeout)
    expect(onRetry).toHaveBeenCalledWith({
      attempt: 2,
      operation: "update_intent",
      reason: "status",
      totalAttempts: 2,
    })
  })

  it("does not retry rate limits and redacts provider failures", async () => {
    const leakedMessage = "customer@example.test sk_live_leaked"
    const updatePaymentIntent = jest.fn().mockRejectedValue({
      message: leakedMessage,
      statusCode: 429,
    })

    const result = syncStripeOrderReferences({
      client: {
        charges: { update: jest.fn() },
        paymentIntents: { update: updatePaymentIntent },
      },
      orderId: "order_01",
      orderNumber: "1042",
      references: [
        {
          amount: null,
          currencyCode: null,
          livemode: false,
          paymentIntentId: "pi_valid123",
          status: null,
        },
      ],
    })

    await expect(result).rejects.toMatchObject<StripeOrderSyncError>({
      code: "provider_unavailable",
      message: "Stripe order sync failed (provider_unavailable).",
      name: "StripeOrderSyncError",
    })
    await expect(result).rejects.not.toThrow(leakedMessage)
    expect(updatePaymentIntent).toHaveBeenCalledTimes(1)
  })

  it("fails closed when the shared deadline is invalid", async () => {
    const update = jest.fn()

    await expect(
      syncStripeOrderReferences({
        client: {
          charges: { update },
          paymentIntents: { update },
        },
        orderId: "order_01",
        orderNumber: "1042",
        references: [
          {
            amount: null,
            currencyCode: null,
            livemode: false,
            paymentIntentId: "pi_valid123",
            status: null,
          },
        ],
        timeoutMs: 0,
      })
    ).rejects.toThrow("Stripe order sync input is invalid")
    expect(update).not.toHaveBeenCalled()
  })
})
