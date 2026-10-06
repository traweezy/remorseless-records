import type { CreateNotificationDTO } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import handler, { config } from "./fulfillment-status"

const fulfillmentFixture = () => ({
  id: "ful_01",
  created_at: "2026-10-04T12:00:00.000Z",
  shipped_at: "2026-10-04T13:00:00.000Z",
  delivered_at: "2026-10-04T14:00:00.000Z",
  canceled_at: null,
  labels: [{ tracking_url: "https://example.com/private-label" }],
  order: {
    id: "order_01",
    display_id: 42,
    email: "delivered@resend.dev",
    customer_id: "cus_01",
    status: "pending",
    shipping_address: { address_1: "do not persist" },
  },
})

const fixture = (name = "order.fulfillment_created") => {
  const fulfillment: Record<string, unknown> = fulfillmentFixture()
  let submitted: CreateNotificationDTO[] = []
  const row = (payload: CreateNotificationDTO) => ({
    ...payload,
    id: "noti_01",
    external_id: "email_01",
    provider_id: "provider_resend",
    status: "success",
    created_at: "2026-10-04T14:01:00.000Z",
  })
  const graph = jest.fn(async () => ({ data: [fulfillment] }))
  const createNotifications = jest.fn(
    async (payloads: CreateNotificationDTO[]) => {
      submitted = payloads
      return payloads.map(row)
    }
  )
  const listNotifications = jest.fn(async () => submitted.map(row))
  const retrieveNotification = jest.fn(async (id: string) =>
    submitted.map(row).find((record) => record.id === id)
  )
  const updateNotifications = jest.fn(async () => null)
  const dependencies = new Map<string, unknown>([
    [ContainerRegistrationKeys.QUERY, { graph }],
    [
      Modules.NOTIFICATION,
      {
        createNotifications,
        listNotifications,
        retrieveNotification,
        updateNotifications,
      },
    ],
  ])
  const input = {
    container: { resolve: (key: string) => dependencies.get(key) },
    event: {
      name,
      data:
        name === "order.fulfillment_created"
          ? {
              order_id: "order_01",
              fulfillment_id: "ful_01",
              no_notification: false,
            }
          : { id: "ful_01", no_notification: false },
    },
  } as unknown as Parameters<typeof handler>[0]
  return { fulfillment, graph, createNotifications, listNotifications, input }
}

describe("native fulfillment notifications", () => {
  it("registers the actual pinned native workflow events", () => {
    expect(config.event).toEqual([
      "order.fulfillment_created",
      "shipment.created",
      "delivery.created",
    ])
  })

  it("reads the order_id emitted by the native fulfillment workflow", async () => {
    const subject = fixture()
    subject.input.event.data = {
      order_id: "order_01",
      fulfillment_id: "ful_01",
      no_notification: false,
    }
    await handler(subject.input)
    expect(subject.createNotifications).toHaveBeenCalledWith([
      expect.objectContaining({
        resource_id: "order_01",
        idempotency_key: "fulfillment-status:ful_01:prepared",
      }),
    ])
  })

  it.each([
    ["order.fulfillment_created", "prepared"],
    ["shipment.created", "shipped"],
    ["delivery.created", "delivered"],
  ])(
    "sends %s only after its persisted native state is verified",
    async (name, status) => {
      const subject = fixture(name)
      await handler(subject.input)
      expect(subject.graph).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: "fulfillment",
          filters: { id: "ful_01" },
        })
      )
      expect(subject.createNotifications).toHaveBeenCalledWith([
        expect.objectContaining({
          idempotency_key: `fulfillment-status:ful_01:${status}`,
          provider_data: {
            idempotency_key: `fulfillment-status:ful_01:${status}`,
          },
          resource_id: "order_01",
          resource_type: "order",
          receiver_id: "cus_01",
          to: "delivered@resend.dev",
          trigger_type: name,
          template: "fulfillment-status",
          data: {
            emailOptions: { subject: expect.any(String) },
            orderDisplayId: 42,
            status,
          },
        }),
      ])
    }
  )

  it.each([
    "order.fulfillment_created",
    "shipment.created",
    "delivery.created",
  ])(
    "honors the native notification opt-out for %s without querying or sending",
    async (name) => {
      const subject = fixture(name)
      subject.input.event.data.no_notification = true
      await handler(subject.input)
      expect(subject.graph).not.toHaveBeenCalled()
      expect(subject.createNotifications).not.toHaveBeenCalled()
    }
  )

  it("keeps a replay's provider payload stable after mutable labels change", async () => {
    const subject = fixture("shipment.created")
    await handler(subject.input)
    const original = subject.createNotifications.mock.calls[0]?.[0]
    subject.fulfillment.labels = [
      { tracking_url: "https://example.com/new-label" },
    ]
    subject.createNotifications.mockResolvedValue([])
    await handler(subject.input)
    expect(subject.createNotifications.mock.calls[1]?.[0]).toEqual(original)
    expect(subject.listNotifications).toHaveBeenCalledWith(
      { idempotency_key: ["fulfillment-status:ful_01:shipped"] },
      { take: 2 }
    )
  })

  it("uses separate business keys for separate partial shipments", async () => {
    const subject = fixture("shipment.created")
    await handler(subject.input)
    subject.fulfillment.id = "ful_02"
    subject.input.event.data.id = "ful_02"
    await handler(subject.input)
    expect(
      subject.createNotifications.mock.calls[0]?.[0]?.[0]?.idempotency_key
    ).toBe("fulfillment-status:ful_01:shipped")
    expect(
      subject.createNotifications.mock.calls[1]?.[0]?.[0]?.idempotency_key
    ).toBe("fulfillment-status:ful_02:shipped")
  })

  it.each([
    ["canceled fulfillment", { canceled_at: "2026-10-04T14:05:00.000Z" }],
    [
      "canceled order",
      { order: { ...fulfillmentFixture().order, status: "canceled" } },
    ],
    [
      "order with no recipient",
      { order: { ...fulfillmentFixture().order, email: null } },
    ],
  ])("does not notify for a %s", async (_label, overrides) => {
    const subject = fixture("shipment.created")
    Object.assign(subject.fulfillment, overrides)
    await handler(subject.input)
    expect(subject.createNotifications).not.toHaveBeenCalled()
  })

  it("ignores generic fulfillment events that have no native order link", async () => {
    const subject = fixture("shipment.created")
    subject.fulfillment.order = null
    await handler(subject.input)
    expect(subject.createNotifications).not.toHaveBeenCalled()
  })

  it.each([
    ["unpersisted shipment", { shipped_at: null }],
    ["invalid timestamp", { shipped_at: "today" }],
    ["wrong fulfillment", { id: "ful_02" }],
    ["malformed cancellation", { canceled_at: false }],
    ["malformed order relation", { order: [] }],
    [
      "wrong order ID type",
      { order: { ...fulfillmentFixture().order, id: "cart_01" } },
    ],
    [
      "invalid recipient",
      {
        order: {
          ...fulfillmentFixture().order,
          email: "one@example.com,two@example.com",
        },
      },
    ],
    [
      "invalid customer ID",
      { order: { ...fulfillmentFixture().order, customer_id: "user_01" } },
    ],
    [
      "invalid order number",
      { order: { ...fulfillmentFixture().order, display_id: false } },
    ],
    [
      "unknown order state",
      { order: { ...fulfillmentFixture().order, status: "unknown" } },
    ],
  ])("rejects a %s before sending", async (_label, overrides) => {
    const subject = fixture("shipment.created")
    Object.assign(subject.fulfillment, overrides)
    await expect(handler(subject.input)).rejects.toThrow(
      /Fulfillment notification/
    )
    expect(subject.createNotifications).not.toHaveBeenCalled()
  })

  it("rejects a creation event linked to a different order", async () => {
    const subject = fixture()
    subject.input.event.data.order_id = "order_02"
    await expect(handler(subject.input)).rejects.toThrow(
      /Fulfillment notification/
    )
    expect(subject.createNotifications).not.toHaveBeenCalled()
  })

  it.each([
    { rows: [] },
    { rows: [fulfillmentFixture(), fulfillmentFixture()] },
  ])("rejects missing or duplicate graph rows", async ({ rows }) => {
    const subject = fixture()
    subject.graph.mockResolvedValue({ data: rows })
    await expect(handler(subject.input)).rejects.toThrow(
      /Fulfillment notification/
    )
    expect(subject.createNotifications).not.toHaveBeenCalled()
  })

  it.each([
    { id: "ful_01" },
    { id: "order_01", fulfillment_id: "ful_01", no_notification: false },
    {
      order_id: "order_01",
      fulfillment_id: "ful_01",
      no_notification: "false",
    },
    { order_id: "order_01", fulfillment_id: "wrong" },
    null,
  ])("rejects malformed event data before querying", async (data) => {
    const subject = fixture()
    subject.input.event.data = data as never
    await expect(handler(subject.input)).rejects.toThrow(
      /Fulfillment notification/
    )
    expect(subject.graph).not.toHaveBeenCalled()
  })

  it("propagates provider failure and requires durable delivery readback", async () => {
    const subject = fixture()
    subject.createNotifications.mockRejectedValueOnce(new Error("safe failure"))
    await expect(handler(subject.input)).rejects.toThrow("safe failure")
    subject.listNotifications.mockResolvedValue([])
    await expect(handler(subject.input)).rejects.toThrow(
      /Notification delivery readback/
    )
  })
})
