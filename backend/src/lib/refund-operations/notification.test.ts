import { buildRefundNotificationPayloads } from "./notification";

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
            { amount: 5, id: "refund_01", note: "Shipping adjustment" },
            { amount: { value: "2.25" }, id: "refund_02" },
          ],
          resourceId: "order_01",
          resourceType: "order",
        },
        template: "refund-issued",
      }),
    ).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          formattedAmount: "$5.00",
          note: "Shipping adjustment",
          referenceLabel: "order #42",
        }),
        idempotency_key: "refund-issued:refund_01",
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
        idempotency_key: "refund-issued:refund_02",
      }),
    ]);
  });

  it("supports a compensated checkout that never created an order", () => {
    expect(
      buildRefundNotificationPayloads({
        context: {
          currencyCode: "usd",
          customerId: null,
          email: "guest@example.com",
          referenceLabel: "your checkout payment",
          refunds: [{ amount: 20, id: "refund_01" }],
          resourceId: "cart_01",
          resourceType: "cart",
        },
        template: "refund-issued",
      }),
    ).toEqual([
      expect.objectContaining({
        receiver_id: null,
        resource_id: "cart_01",
        resource_type: "cart",
      }),
    ]);
  });

  it("drops malformed amounts instead of sending a misleading email", () => {
    expect(
      buildRefundNotificationPayloads({
        context: {
          currencyCode: "usd",
          customerId: null,
          email: "guest@example.com",
          referenceLabel: "your payment",
          refunds: [{ amount: "not-an-amount", id: "refund_01" }],
          resourceId: "cart_01",
          resourceType: "cart",
        },
        template: "refund-issued",
      }),
    ).toEqual([]);
  });
});
