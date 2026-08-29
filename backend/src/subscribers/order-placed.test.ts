import { Modules } from "@medusajs/framework/utils";

import orderPlacedHandler from "./order-placed";

const orderFixture = (overrides: Record<string, unknown> = {}) => ({
  created_at: "2026-08-29T12:00:00.000Z",
  currency_code: "usd",
  customer_id: "cus_01",
  display_id: "42",
  email: "customer@example.com",
  id: "order_01",
  items: [],
  shipping_address: {
    address_1: "123 Main St",
    city: "Baltimore",
    country_code: "US",
    first_name: "Test",
    last_name: "Customer",
    postal_code: "21201",
    province: "MD",
  },
  summary: { raw_current_order_total: { value: 25 } },
  ...overrides,
});

const fixture = (order = orderFixture()) => {
  const createNotifications = jest.fn(async () => []);
  const retrieveOrder = jest.fn(async () => order);
  const dependencies = new Map<string, unknown>([
    [Modules.NOTIFICATION, { createNotifications }],
    [Modules.ORDER, { retrieveOrder }],
  ]);
  const input = {
    container: {
      resolve: (name: string) => dependencies.get(name),
    },
    event: {
      data: { id: "order_01" },
      name: "order.placed",
    },
  } as unknown as Parameters<typeof orderPlacedHandler>[0];

  return { createNotifications, input, retrieveOrder };
};

describe("order confirmation subscriber", () => {
  it("uses database and provider idempotency scoped to the order", async () => {
    const input = fixture();

    await expect(orderPlacedHandler(input.input)).resolves.toBeUndefined();

    expect(input.createNotifications).toHaveBeenCalledWith([
      expect.objectContaining({
        idempotency_key: "order-placed:order_01",
        provider_data: {
          idempotency_key: "order-placed:order_01",
        },
        receiver_id: "cus_01",
        resource_id: "order_01",
        resource_type: "order",
        trigger_type: "order.placed",
      }),
    ]);
  });

  it.each([
    ["missing email", { email: null }],
    ["missing shipping address", { shipping_address: null }],
  ])("does not create a notification for %s", async (_label, overrides) => {
    const input = fixture(orderFixture(overrides));

    await orderPlacedHandler(input.input);

    expect(input.createNotifications).not.toHaveBeenCalled();
  });

  it("propagates delivery failure so the idempotent event can retry", async () => {
    const input = fixture();
    input.createNotifications.mockRejectedValue(
      new Error("safe provider failure"),
    );

    await expect(orderPlacedHandler(input.input)).rejects.toThrow(
      "safe provider failure",
    );
  });
});
