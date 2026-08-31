import type { CreateNotificationDTO } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

import orderPlacedHandler from "./order-placed"

const orderFixture = (overrides: Record<string, unknown> = {}) => ({
  created_at: "2026-08-29T12:00:00.000Z",
  currency_code: "usd",
  customer_id: "cus_01",
  display_id: 42,
  email: "customer@example.com",
  id: "order_01",
  items: [
    {
      id: "ordli_01",
      product_title: "Test release",
      quantity: 1,
      title: "Black vinyl",
      unit_price: 25,
    },
  ],
  metadata: { private_note: "do not persist" },
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
})

const notificationRow = (payload: CreateNotificationDTO) => ({
  ...payload,
  created_at: "2026-08-29T12:00:00.000Z",
  external_id: "email_01",
  id: "noti_01",
  provider_id: "provider_resend",
  status: "success",
})

const fixture = (order = orderFixture()) => {
  let submitted: CreateNotificationDTO[] = []
  const createNotifications = jest.fn(
    async (payloads: CreateNotificationDTO[]) => {
      submitted = payloads
      return payloads.map(notificationRow)
    }
  )
  const listNotifications = jest.fn(async () => submitted.map(notificationRow))
  const retrieveOrder = jest.fn(async () => order)
  const dependencies = new Map<string, unknown>([
    [Modules.NOTIFICATION, { createNotifications, listNotifications }],
    [Modules.ORDER, { retrieveOrder }],
  ])
  const input = {
    container: {
      resolve: (name: string) => dependencies.get(name),
    },
    event: {
      data: { id: "order_01" },
      name: "order.placed",
    },
  } as unknown as Parameters<typeof orderPlacedHandler>[0]

  return { createNotifications, input, listNotifications, retrieveOrder }
}

describe("order confirmation subscriber", () => {
  it("uses database and provider idempotency scoped to the order", async () => {
    const input = fixture()

    await expect(orderPlacedHandler(input.input)).resolves.toBeUndefined()

    expect(input.createNotifications).toHaveBeenCalledWith([
      expect.objectContaining({
        data: expect.objectContaining({
          emailOptions: {
            subject: "Your order has been placed",
          },
        }),
        idempotency_key: "order-placed:order_01",
        provider_data: {
          idempotency_key: "order-placed:order_01",
        },
        receiver_id: "cus_01",
        resource_id: "order_01",
        resource_type: "order",
        trigger_type: "order.placed",
      }),
    ])
    const created = input.createNotifications.mock.calls[0]?.[0]?.[0]
    expect(created?.data).toEqual(
      expect.objectContaining({
        order: expect.not.objectContaining({
          email: expect.anything(),
          metadata: expect.anything(),
        }),
      })
    )
    expect(input.listNotifications).toHaveBeenCalledWith(
      { idempotency_key: ["order-placed:order_01"] },
      { take: 2 }
    )
  })

  it.each([
    ["missing email", { email: null }],
    ["missing shipping address", { shipping_address: null }],
  ])("does not create a notification for %s", async (_label, overrides) => {
    const input = fixture(orderFixture(overrides))

    await orderPlacedHandler(input.input)

    expect(input.createNotifications).not.toHaveBeenCalled()
  })

  it("propagates delivery failure so the idempotent event can retry", async () => {
    const input = fixture()
    input.createNotifications.mockRejectedValue(
      new Error("safe provider failure")
    )

    await expect(orderPlacedHandler(input.input)).rejects.toThrow(
      "safe provider failure"
    )
  })

  it("accepts an idempotent replay only after its durable row is verified", async () => {
    const input = fixture()
    let submitted: CreateNotificationDTO[] = []
    input.createNotifications.mockImplementation(async (payloads) => {
      submitted = payloads
      return []
    })
    input.listNotifications.mockImplementation(async () =>
      submitted.map(notificationRow)
    )

    await expect(orderPlacedHandler(input.input)).resolves.toBeUndefined()
  })

  it("rejects a missing durable delivery row", async () => {
    const input = fixture()
    input.listNotifications.mockResolvedValue([])

    await expect(orderPlacedHandler(input.input)).rejects.toThrow(
      "Notification delivery readback is malformed"
    )
  })

  it.each([
    ["mismatched order ID", { id: "order_02" }],
    ["coercive order number", { display_id: false }],
    ["malformed present email", { email: false }],
    ["missing item relation", { items: undefined }],
  ])("rejects a %s", async (_label, overrides) => {
    const input = fixture(orderFixture(overrides))

    await expect(orderPlacedHandler(input.input)).rejects.toThrow(
      /Order notification/
    )
    expect(input.createNotifications).not.toHaveBeenCalled()
  })

  it("rejects a malformed event before querying the order", async () => {
    const input = fixture()
    input.input.event.data = { id: false } as never

    await expect(orderPlacedHandler(input.input)).rejects.toThrow(
      "Order notification event is malformed"
    )
    expect(input.retrieveOrder).not.toHaveBeenCalled()
  })
})
