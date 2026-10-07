import type { CreateNotificationDTO } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import handler, { config } from "./after-sales-status"

const operations = [
  [
    "order.return_requested",
    "return",
    "return_id",
    "return_01",
    "return_request",
    "return-requested",
  ],
  [
    "order.return_received",
    "return",
    "return_id",
    "return_01",
    "return_receive",
    "return-received",
  ],
  [
    "order.claim_created",
    "order_claim",
    "claim_id",
    "claim_01",
    "claim",
    "claim-confirmed",
  ],
  [
    "order.exchange_created",
    "order_exchange",
    "exchange_id",
    "oexc_01",
    "exchange",
    "exchange-confirmed",
  ],
] as const

const fixture = (operation: (typeof operations)[number] = operations[0]) => {
  const [name, entity, field, id, type] = operation
  const resource: Record<string, unknown> = {
    id,
    order_id: "order_01",
    created_at: "2026-10-06T12:00:00Z",
    canceled_at: null,
    status: "received",
    requested_at: "2026-10-06T12:01:00Z",
    received_at: "2026-10-06T12:02:00Z",
    order: {
      id: "order_01",
      display_id: 42,
      email: "delivered@resend.dev",
      customer_id: "cus_01",
      status: "pending",
      shipping_address: "private",
    },
  }
  const change: Record<string, unknown> = {
    id: "ordch_01",
    order_id: "order_01",
    [field]: id,
    change_type: type,
    status: "confirmed",
    confirmed_at: "2026-10-06T12:02:00Z",
    canceled_at: null,
  }
  const rows = new Map<string, Record<string, unknown>>()
  const createNotifications = jest.fn(
    async (payloads: CreateNotificationDTO[]) => {
      const created = []
      for (const payload of payloads) {
        if (rows.has(payload.idempotency_key!)) continue
        const row = {
          ...payload,
          id: "noti_01",
          external_id: "email_01",
          provider_id: "fixture_resend",
          status: "success",
          created_at: "2026-10-06T12:03:00Z",
        }
        rows.set(payload.idempotency_key!, row)
        created.push(row)
      }
      return created
    }
  )
  const listNotifications = jest.fn(
    async ({ idempotency_key }: { idempotency_key: string[] }) =>
      idempotency_key.flatMap((key) => (rows.has(key) ? [rows.get(key)!] : []))
  )
  const graph = jest.fn(async (input: { entity: string }) => ({
    data: input.entity === entity ? [resource] : [change],
  }))
  const input = {
    event: {
      name,
      data: {
        order_id: "order_01",
        order_change_id: "ordch_01",
        [field]: id,
        ...(name === "order.return_received"
          ? { return_status: "received" }
          : {}),
        no_notification: false,
      },
    },
    container: {
      resolve: (key: string) =>
        key === ContainerRegistrationKeys.QUERY
          ? { graph }
          : key === Modules.NOTIFICATION
            ? {
                createNotifications,
                listNotifications,
                retrieveNotification: async () => rows.values().next().value,
                updateNotifications: async () => null,
              }
            : null,
    },
  } as unknown as Parameters<typeof handler>[0]
  return {
    input,
    resource,
    change,
    graph,
    rows,
    createNotifications,
    listNotifications,
  }
}

describe("native after-sales notifications", () => {
  it("registers the four pinned native confirmation events", () => {
    expect(config.event).toEqual(operations.map(([name]) => name))
  })
  it.each(operations.map((operation) => ({ operation, name: operation[0] })))(
    "verifies $name and keeps its projection stable on replay",
    async ({ operation }) => {
      const subject = fixture(operation)
      await handler(subject.input)
      expect(subject.graph).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: operation[1],
          filters: { id: operation[3] },
        })
      )
      expect(subject.graph).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: "order_change",
          filters: { id: "ordch_01" },
        })
      )
      const original = subject.createNotifications.mock.calls[0]![0]
      expect(original).toEqual([
        expect.objectContaining({
          idempotency_key: `after-sales-status:${operation[3]}:${operation[5]}`,
          provider_data: {
            idempotency_key: `after-sales-status:${operation[3]}:${operation[5]}`,
          },
          to: "delivered@resend.dev",
          resource_id: "order_01",
          resource_type: "order",
          receiver_id: "cus_01",
          trigger_type: operation[0],
          template: "after-sales-status",
          data: {
            orderDisplayId: 42,
            status: operation[5],
            emailOptions: { subject: expect.any(String) },
          },
        }),
      ])
      subject.resource.items = [{ title: "mutable private item" }]
      await handler(subject.input)
      expect(subject.rows.size).toBe(1)
      expect(subject.createNotifications.mock.calls[1]![0]).toEqual(original)
    }
  )
  it.each([true, undefined])(
    "does not opt legacy events into email (%s)",
    async (preference) => {
      const subject = fixture()
      subject.input.event.data =
        preference === undefined ? {} : { no_notification: preference }
      await handler(subject.input)
      expect(subject.graph).not.toHaveBeenCalled()
      expect(subject.createNotifications).not.toHaveBeenCalled()
    }
  )
  it.each(["false", 0, null, []])(
    "rejects malformed preferences (%s)",
    async (preference) => {
      const subject = fixture()
      subject.input.event.data.no_notification =
        preference as unknown as boolean
      await expect(handler(subject.input)).rejects.toThrow("malformed")
      expect(subject.createNotifications).not.toHaveBeenCalled()
    }
  )
  it.each(["order_id", "order_change_id", "return_id"] as const)(
    "requires the exact opt-in identity %s",
    async (field) => {
      const subject = fixture()
      delete subject.input.event.data[field]
      await expect(handler(subject.input)).rejects.toThrow("malformed")
      expect(subject.graph).not.toHaveBeenCalled()
    }
  )
  it.each([
    ["id", "return_other"],
    ["order_id", "order_other"],
    ["created_at", "invalid"],
    ["requested_at", null],
    ["status", "invented"],
    ["canceled_at", "invalid"],
  ])("rejects malformed or mismatched resource %s", async (field, value) => {
    const subject = fixture()
    subject.resource[field] = value
    await expect(handler(subject.input)).rejects.toThrow("malformed")
    expect(subject.createNotifications).not.toHaveBeenCalled()
  })
  it.each([
    ["id", "ordch_other"],
    ["order_id", "order_other"],
    ["return_id", "return_other"],
    ["change_type", "claim"],
    ["status", "pending"],
    ["confirmed_at", null],
    ["canceled_at", "invalid"],
  ])(
    "rejects unconfirmed or mismatched native change %s",
    async (field, value) => {
      const subject = fixture()
      subject.change[field] = value
      await expect(handler(subject.input)).rejects.toThrow("malformed")
      expect(subject.createNotifications).not.toHaveBeenCalled()
    }
  )
  it("does not call a partial receipt complete", async () => {
    const subject = fixture(operations[1])
    subject.resource.status = "partially_received"
    await handler(subject.input)
    expect(subject.createNotifications).not.toHaveBeenCalled()
  })
  it("does not replay a partial opt-in after a later opted-out full receipt", async () => {
    const subject = fixture(operations[1])
    subject.input.event.data.return_status = "partially_received"
    await handler(subject.input)
    expect(subject.graph).not.toHaveBeenCalled()
    expect(subject.createNotifications).not.toHaveBeenCalled()
  })
  it.each([undefined, "requested", "unknown"])(
    "requires the confirmation's complete receipt state (%s)",
    async (status) => {
      const subject = fixture(operations[1])
      if (status === undefined) delete subject.input.event.data.return_status
      else subject.input.event.data.return_status = status
      await expect(handler(subject.input)).rejects.toThrow("malformed")
      expect(subject.graph).not.toHaveBeenCalled()
    }
  )
  it.each(["requested", "open"])(
    "rejects an unreceived return (%s)",
    async (status) => {
      const subject = fixture(operations[1])
      subject.resource.status = status
      await expect(handler(subject.input)).rejects.toThrow("malformed")
    }
  )
  it("requires the full receipt's timestamp", async () => {
    const subject = fixture(operations[1])
    subject.resource.received_at = null
    await expect(handler(subject.input)).rejects.toThrow("malformed")
  })
  it.each(["resource", "change"] as const)(
    "skips canceled %s",
    async (target) => {
      const subject = fixture()
      subject[target].canceled_at = "2026-10-06T12:04:00Z"
      await handler(subject.input)
      expect(subject.createNotifications).not.toHaveBeenCalled()
    }
  )
  it.each(["canceled", "draft"])("skips %s orders", async (status) => {
    const subject = fixture()
    ;(subject.resource.order as Record<string, unknown>).status = status
    await handler(subject.input)
    expect(subject.createNotifications).not.toHaveBeenCalled()
  })
  it.each([
    ["id", "order_other"],
    ["email", "invalid"],
    ["display_id", 0],
    ["customer_id", "invalid"],
    ["status", "unknown"],
  ])("rejects malformed order %s", async (field, value) => {
    const subject = fixture()
    ;(subject.resource.order as Record<string, unknown>)[field] = value
    await expect(handler(subject.input)).rejects.toThrow("malformed")
    expect(subject.createNotifications).not.toHaveBeenCalled()
  })
  it("skips absent recipients and permits native guest orders", async () => {
    const subject = fixture()
    const order = subject.resource.order as Record<string, unknown>
    order.email = null
    await handler(subject.input)
    expect(subject.createNotifications).not.toHaveBeenCalled()
    order.email = "delivered@resend.dev"
    order.customer_id = null
    await handler(subject.input)
    expect(
      subject.createNotifications.mock.calls[0]![0][0]!.receiver_id
    ).toBeNull()
  })
  it("propagates provider failure for native event retry", async () => {
    const subject = fixture()
    subject.createNotifications.mockRejectedValueOnce(
      new Error("provider failure")
    )
    await expect(handler(subject.input)).rejects.toThrow("provider failure")
    expect(subject.rows.size).toBe(0)
  })
  it("rejects missing durable success acknowledgement", async () => {
    const subject = fixture()
    subject.listNotifications.mockResolvedValue([])
    await expect(handler(subject.input)).rejects.toThrow()
  })
  it("rejects empty/ambiguous resource and change reads", async () => {
    for (const queryIndex of [1, 2]) {
      for (const count of [0, 2]) {
        const subject = fixture()
        const original = subject.graph.getMockImplementation()!
        let calls = 0
        subject.graph.mockImplementation(async (input) => {
          const result = await original(input)
          return ++calls === queryIndex
            ? { data: Array.from({ length: count }, () => result.data[0]!) }
            : result
        })
        await expect(handler(subject.input)).rejects.toThrow("malformed")
        expect(subject.createNotifications).not.toHaveBeenCalled()
      }
    }
  })
  it("rejects an unrelated event", async () => {
    const subject = fixture()
    subject.input.event.name = "order.placed"
    await expect(handler(subject.input)).rejects.toThrow("malformed")
  })
})
