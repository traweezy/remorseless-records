import type {
  CreateNotificationDTO,
  INotificationModuleService,
} from "@medusajs/framework/types"

import {
  buildInviteNotificationLink,
  createAndVerifyNotifications,
  inviteNotificationIdempotencyKey,
  readInviteNotificationProjection,
  readNotificationEmail,
  readOrderNotificationProjection,
} from "./contracts"

const invite = (overrides: Record<string, unknown> = {}) => ({
  accepted: false,
  deleted_at: null,
  email: "operator@example.com",
  expires_at: "2099-01-01T00:00:00.000Z",
  id: "invite_01",
  token: "invite.token-value_01",
  ...overrides,
})

const order = (overrides: Record<string, unknown> = {}) => ({
  created_at: "2026-08-29T12:00:00.000Z",
  currency_code: "usd",
  customer_id: "cus_01",
  display_id: 42,
  email: "customer@example.com",
  id: "order_01",
  items: [
    {
      id: "ordli_01",
      product_title: "Limited release",
      quantity: 2,
      title: "Black vinyl",
      unit_price: { value: "25.25" },
    },
  ],
  shipping_address: {
    address_1: "123 Main St",
    city: "Baltimore",
    country_code: "us",
    first_name: "Test",
    last_name: "Customer",
    postal_code: "21201",
    province: "MD",
  },
  summary: { raw_current_order_total: { value: "50.50" } },
  ...overrides,
})

const payload = (
  overrides: Partial<CreateNotificationDTO> = {}
): CreateNotificationDTO => ({
  channel: "email",
  data: {
    emailOptions: { subject: "Subject" },
    message: "Safe message",
  },
  idempotency_key: "order-placed:order_01",
  provider_data: { idempotency_key: "order-placed:order_01" },
  receiver_id: "cus_01",
  resource_id: "order_01",
  resource_type: "order",
  template: "order-placed",
  to: "customer@example.com",
  trigger_type: "order.placed",
  ...overrides,
})

const persisted = (
  expected: CreateNotificationDTO,
  overrides: Record<string, unknown> = {}
) => ({
  ...expected,
  created_at: "2026-08-29T12:00:00.000Z",
  external_id: "email_01",
  id: "noti_01",
  provider_id: "provider_resend",
  status: "success",
  ...overrides,
})

const service = ({
  acknowledgement,
  readback,
}: {
  acknowledgement?: unknown
  readback?: unknown
} = {}) => {
  let submitted: CreateNotificationDTO[] = []
  let durable: unknown = readback
  const createNotifications = jest.fn(
    async (input: CreateNotificationDTO[]) => {
      submitted = input
      return acknowledgement ?? input.map((entry) => persisted(entry))
    }
  )
  const listNotifications = jest.fn(async () => {
    if (durable === undefined) {
      durable = submitted.map((entry) => persisted(entry))
    }
    return durable
  })
  const updateNotifications = jest.fn(
    async (input: { data: Record<string, unknown>; id: string }) => {
      if (!Array.isArray(durable)) {
        return null
      }
      const current = durable.find(
        (entry) =>
          entry !== null &&
          typeof entry === "object" &&
          "id" in entry &&
          entry.id === input.id
      )
      if (!current || typeof current !== "object") {
        return null
      }
      const updated = { ...current, data: input.data }
      durable = durable.map((entry) => (entry === current ? updated : entry))
      return updated
    }
  )
  const retrieveNotification = jest.fn(async (id: string) =>
    Array.isArray(durable)
      ? durable.find(
          (entry) =>
            entry !== null &&
            typeof entry === "object" &&
            "id" in entry &&
            entry.id === id
        )
      : null
  )
  return {
    createNotifications,
    listNotifications,
    retrieveNotification,
    updateNotifications,
    value: {
      createNotifications,
      listNotifications,
      retrieveNotification,
      updateNotifications,
    } as unknown as INotificationModuleService,
  }
}

describe("notification boundary contracts", () => {
  describe("invite projection", () => {
    it("returns only the validated delivery fields", () => {
      expect(
        readInviteNotificationProjection(
          invite({ metadata: { private: true } }),
          "invite_01"
        )
      ).toEqual({
        email: "operator@example.com",
        id: "invite_01",
        token: "invite.token-value_01",
      })
    })

    it.each([
      ["mismatched ID", { id: "invite_02" }],
      ["invalid email", { email: "operator" }],
      ["unsafe token", { token: "token with spaces" }],
      ["accepted invite", { accepted: true }],
      ["expired invite", { expires_at: "2020-01-01T00:00:00.000Z" }],
      ["deleted invite", { deleted_at: "2026-01-01T00:00:00.000Z" }],
    ])("rejects a %s", (_label, overrides) => {
      expect(() =>
        readInviteNotificationProjection(invite(overrides), "invite_01")
      ).toThrow("Invite notification projection is malformed")
    })

    it("builds an encoded HTTPS link without carrying an input path", () => {
      expect(
        buildInviteNotificationLink(
          "backend.example.com/ignored?unsafe=true",
          "token+with/value"
        )
      ).toBe(
        "https://backend.example.com/app/invite?token=token%2Bwith%2Fvalue"
      )
    })

    it("rejects insecure remote and credentialed invite origins", () => {
      expect(() =>
        buildInviteNotificationLink("http://backend.example.com", "token")
      ).toThrow("backend URL is malformed")
      expect(() =>
        buildInviteNotificationLink(
          "https://user:password@backend.example.com",
          "token"
        )
      ).toThrow("backend URL is malformed")
    })

    it("derives a stable non-PII key that changes with the invite token", () => {
      const projection = readInviteNotificationProjection(invite(), "invite_01")
      const key = inviteNotificationIdempotencyKey(projection)

      expect(key).toMatch(/^invite-user:invite_01:[a-f0-9]{32}$/)
      expect(key).not.toContain(projection.email)
      expect(key).not.toContain(projection.token)
      expect(inviteNotificationIdempotencyKey(projection)).toBe(key)
      expect(
        inviteNotificationIdempotencyKey({ ...projection, token: "new-token" })
      ).not.toBe(key)
    })
  })

  describe("order projection", () => {
    it("returns a minimal JSON-safe receipt projection", () => {
      expect(
        readOrderNotificationProjection(
          order({ metadata: { private: true } }),
          "order_01"
        )
      ).toEqual({
        customerId: "cus_01",
        email: "customer@example.com",
        order: {
          created_at: "2026-08-29T12:00:00.000Z",
          currency_code: "usd",
          display_id: 42,
          id: "order_01",
          items: [
            {
              id: "ordli_01",
              product_title: "Limited release",
              quantity: 2,
              title: "Black vinyl",
              unit_price: 25.25,
            },
          ],
          summary: { raw_current_order_total: 50.5 },
        },
        shippingAddress: {
          address_1: "123 Main St",
          city: "Baltimore",
          country_code: "US",
          first_name: "Test",
          last_name: "Customer",
          postal_code: "21201",
          province: "MD",
        },
      })
    })

    it.each([
      ["mismatched order", { id: "order_02" }],
      ["coercive display ID", { display_id: false }],
      ["invalid customer ID", { customer_id: "customer_01" }],
      ["invalid currency", { currency_code: "US" }],
      ["missing items", { items: [] }],
      ["duplicate items", { items: [order().items[0], order().items[0]] }],
      [
        "negative item price",
        { items: [{ ...order().items[0], unit_price: -1 }] },
      ],
      ["malformed total", { summary: { raw_current_order_total: false } }],
      [
        "malformed address",
        { shipping_address: { ...order().shipping_address, city: false } },
      ],
    ])("rejects %s", (_label, overrides) => {
      expect(() =>
        readOrderNotificationProjection(order(overrides), "order_01")
      ).toThrow(/Order notification/)
    })

    it.each([
      ["missing email", { email: null }],
      ["missing shipping address", { shipping_address: null }],
    ])("skips a genuinely %s", (_label, overrides) => {
      expect(
        readOrderNotificationProjection(order(overrides), "order_01")
      ).toBeNull()
    })

    it("rejects a malformed present recipient instead of silently skipping", () => {
      expect(() =>
        readOrderNotificationProjection(order({ email: false }), "order_01")
      ).toThrow("Order notification projection is malformed")
    })
  })

  describe("durable delivery readback", () => {
    it("accepts an exact successful acknowledgement and durable row", async () => {
      const input = service()

      await expect(
        createAndVerifyNotifications(input.value, [payload()])
      ).resolves.toBeUndefined()

      expect(input.listNotifications).toHaveBeenCalledWith(
        { idempotency_key: ["order-placed:order_01"] },
        { take: 2 }
      )
    })

    it("accepts Medusa's empty acknowledgement on a successful replay", async () => {
      const expected = payload()
      const input = service({
        acknowledgement: [],
        readback: [persisted(expected)],
      })

      await expect(
        createAndVerifyNotifications(input.value, [expected])
      ).resolves.toBeUndefined()
    })

    it("redacts delivered secret data and verifies the final durable row", async () => {
      const expected = payload({
        data: {
          emailOptions: { subject: "Invite" },
          inviteLink: "https://backend.example.com/app/invite?token=secret",
        },
        idempotency_key: "invite-user:invite_01:digest",
        provider_data: {
          idempotency_key: "invite-user:invite_01:digest",
        },
        resource_id: "invite_01",
        resource_type: "invite",
        template: "invite-user",
        to: "operator@example.com",
        trigger_type: "invite.created",
      })
      const input = service()
      const retained = {
        delivery_state: "sent",
        secret_fields: "redacted",
        version: 1,
      }

      await createAndVerifyNotifications(input.value, [expected], {
        "invite-user:invite_01:digest": retained,
      })

      expect(input.updateNotifications).toHaveBeenCalledWith({
        data: retained,
        id: "noti_01",
      })
      expect(input.retrieveNotification).toHaveBeenCalledWith("noti_01")
      expect(await input.retrieveNotification("noti_01")).toEqual(
        expect.objectContaining({ data: retained })
      )
    })

    it("accepts a replay whose secret data was already redacted", async () => {
      const expected = payload({
        idempotency_key: "invite-user:invite_01:digest",
        provider_data: {
          idempotency_key: "invite-user:invite_01:digest",
        },
      })
      const retained = { secret_fields: "redacted" }
      const input = service({
        acknowledgement: [],
        readback: [persisted(expected, { data: retained })],
      })

      await expect(
        createAndVerifyNotifications(input.value, [expected], {
          "invite-user:invite_01:digest": retained,
        })
      ).resolves.toBeUndefined()
      expect(input.updateNotifications).not.toHaveBeenCalled()
    })

    it("rejects an unverified secret-data redaction", async () => {
      const expected = payload()
      const input = service()
      input.updateNotifications.mockResolvedValue(null)

      await expect(
        createAndVerifyNotifications(input.value, [expected], {
          "order-placed:order_01": { secret_fields: "redacted" },
        })
      ).rejects.toThrow(
        "Notification data-retention acknowledgement is malformed"
      )
    })

    it.each([
      ["primitive acknowledgement", false, undefined],
      [
        "foreign acknowledgement",
        [persisted(payload(), { idempotency_key: "other" })],
        undefined,
      ],
      ["missing readback", [], []],
      [
        "duplicate readback",
        [],
        [persisted(payload()), persisted(payload(), { id: "noti_02" })],
      ],
      ["failed readback", [], [persisted(payload(), { status: "failure" })]],
      [
        "missing external ID",
        [],
        [persisted(payload(), { external_id: null })],
      ],
      [
        "mismatched recipient",
        [],
        [persisted(payload(), { to: "other@example.com" })],
      ],
      [
        "mismatched data",
        [],
        [persisted(payload(), { data: { changed: true } })],
      ],
    ])("rejects a %s", async (_label, acknowledgement, readback) => {
      const input = service({ acknowledgement, readback })

      await expect(
        createAndVerifyNotifications(input.value, [payload()])
      ).rejects.toThrow(/Notification delivery/)
    })

    it("rejects duplicate keys and provider-key mismatches before sending", async () => {
      const input = service()
      const duplicate = payload()

      await expect(
        createAndVerifyNotifications(input.value, [payload(), duplicate])
      ).rejects.toThrow("Notification delivery batch is malformed")
      await expect(
        createAndVerifyNotifications(input.value, [
          payload({ provider_data: { idempotency_key: "other" } }),
        ])
      ).rejects.toThrow("Notification delivery payload is malformed")
      expect(input.createNotifications).not.toHaveBeenCalled()
    })

    it("rejects a notification service without durable verification methods", async () => {
      const input = service()
      const incompleteService = {
        createNotifications: input.createNotifications,
        listNotifications: input.listNotifications,
        retrieveNotification: input.retrieveNotification,
      } as unknown as INotificationModuleService

      await expect(
        createAndVerifyNotifications(incompleteService, [payload()])
      ).rejects.toThrow("Notification persistence service is malformed")
      expect(input.createNotifications).not.toHaveBeenCalled()
    })
  })

  it.each(["customer@example.com", "orders+test@records.example"])(
    "accepts the valid mailbox %s",
    (email) => {
      expect(readNotificationEmail(email)).toBe(email)
    }
  )

  it.each([
    "customer",
    "Customer <customer@example.com>",
    "a@b",
    "a b@example.com",
  ])("rejects the invalid mailbox %s", (email) => {
    expect(readNotificationEmail(email)).toBeNull()
  })
})
