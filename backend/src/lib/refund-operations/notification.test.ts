import { buildRefundNotificationPayloads } from "./notification"

describe("refund customer notification payloads", () => {
  it("builds one idempotent message for every partial refund", () => {
    expect(
      buildRefundNotificationPayloads({
        context: {
          currencyCode: "usd",
          customerId: "cus_01",
          email: "customer@example.com",
          referenceLabel: "order #42",
          refunds: [
            {
              amount: 5,
              id: "ref_01M43FX51KH7H2ZGHNARDNCZHP",
              note: "Shipping adjustment",
            },
            { amount: { value: "2.25" }, id: "ref_01M43FX51KH7H2ZGHNARDNCZHQ" },
          ],
          resourceId: "order_01",
          resourceType: "order",
        },
        template: "refund-issued",
      })
    ).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          formattedAmount: "$5.00",
          note: "Shipping adjustment",
          referenceLabel: "order #42",
        }),
        idempotency_key: "refund-issued:ref_01M43FX51KH7H2ZGHNARDNCZHP",
        provider_data: {
          idempotency_key: "refund-issued:ref_01M43FX51KH7H2ZGHNARDNCZHP",
        },
        receiver_id: "cus_01",
        resource_id: "order_01",
        resource_type: "order",
        to: "customer@example.com",
        trigger_type: "payment.refunded",
      }),
      expect.objectContaining({
        data: expect.objectContaining({
          formattedAmount: "$2.25",
          note: null,
        }),
        idempotency_key: "refund-issued:ref_01M43FX51KH7H2ZGHNARDNCZHQ",
        provider_data: {
          idempotency_key: "refund-issued:ref_01M43FX51KH7H2ZGHNARDNCZHQ",
        },
      }),
    ])
  })

  it("supports a compensated checkout that never created an order", () => {
    expect(
      buildRefundNotificationPayloads({
        context: {
          currencyCode: "usd",
          customerId: null,
          email: "guest@example.com",
          referenceLabel: "your checkout payment",
          refunds: [{ amount: 20, id: "ref_01M43FX51KH7H2ZGHNARDNCZHP" }],
          resourceId: "cart_01",
          resourceType: "cart",
        },
        template: "refund-issued",
      })
    ).toEqual([
      expect.objectContaining({
        receiver_id: null,
        resource_id: "cart_01",
        resource_type: "cart",
      }),
    ])
  })

  it("drops malformed amounts instead of sending a misleading email", () => {
    expect(
      buildRefundNotificationPayloads({
        context: {
          currencyCode: "usd",
          customerId: null,
          email: "guest@example.com",
          referenceLabel: "your payment",
          refunds: [
            { amount: "not-an-amount", id: "ref_01M43FX51KH7H2ZGHNARDNCZHP" },
          ],
          resourceId: "cart_01",
          resourceType: "cart",
        },
        template: "refund-issued",
      })
    ).toEqual([])
  })

  it.each([
    ["recipient", { email: "guest" }],
    ["resource", { resourceId: "unsafe" }],
    ["customer", { customerId: "unsafe" }],
    ["reference", { referenceLabel: "x".repeat(121) }],
    ["refund ID", { refunds: [{ amount: 20, id: "unsafe" }] }],
    ["non-native refund ID", { refunds: [{ amount: 20, id: "refund_01" }] }],
    ["Stripe refund ID", { refunds: [{ amount: 20, id: "re_01" }] }],
    [
      "refund note",
      {
        refunds: [
          {
            amount: 20,
            id: "ref_01M43FX51KH7H2ZGHNARDNCZHP",
            note: "x".repeat(2_001),
          },
        ],
      },
    ],
  ])("drops a malformed %s", (_label, overrides) => {
    expect(
      buildRefundNotificationPayloads({
        context: {
          currencyCode: "usd",
          customerId: "cus_01",
          email: "guest@example.com",
          referenceLabel: "order #42",
          refunds: [{ amount: 20, id: "ref_01M43FX51KH7H2ZGHNARDNCZHP" }],
          resourceId: "order_01",
          resourceType: "order",
          ...overrides,
        },
        template: "refund-issued",
      })
    ).toEqual([])
  })

  it("rejects duplicate refund IDs before building a partial batch", () => {
    expect(
      buildRefundNotificationPayloads({
        context: {
          currencyCode: "usd",
          customerId: null,
          email: "guest@example.com",
          referenceLabel: "your payment",
          refunds: [
            { amount: 5, id: "ref_01M43FX51KH7H2ZGHNARDNCZHP" },
            { amount: 5, id: "ref_01M43FX51KH7H2ZGHNARDNCZHP" },
          ],
          resourceId: "cart_01",
          resourceType: "cart",
        },
        template: "refund-issued",
      })
    ).toEqual([])
  })
})
