import type { CreateNotificationDTO } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

import userInviteHandler from "./invite-created"

const invite = (overrides: Record<string, unknown> = {}) => ({
  accepted: false,
  deleted_at: null,
  email: "operator@example.com",
  expires_at: "2099-01-01T00:00:00.000Z",
  id: "invite_01",
  metadata: { role_hint: "private" },
  token: "invite.token+value/01",
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

const fixture = ({
  eventData = { id: "invite_01" },
  eventName = "invite.created",
  inviteValue = invite(),
}: {
  eventData?: unknown
  eventName?: string
  inviteValue?: unknown
} = {}) => {
  let submitted: CreateNotificationDTO[] = []
  let durable: Array<Record<string, unknown>> = []
  const createNotifications = jest.fn(
    async (payloads: CreateNotificationDTO[]) => {
      submitted = payloads
      durable = payloads.map(notificationRow)
      return durable
    }
  )
  const listNotifications = jest.fn(async () =>
    durable.length ? durable : submitted.map(notificationRow)
  )
  const updateNotifications = jest.fn(
    async (update: { data: Record<string, unknown>; id: string }) => {
      const current = durable.find((record) => record.id === update.id)
      if (!current) {
        return null
      }
      const updated = { ...current, data: update.data }
      durable = durable.map((record) =>
        record.id === update.id ? updated : record
      )
      return updated
    }
  )
  const retrieveNotification = jest.fn(async (id: string) =>
    durable.find((record) => record.id === id)
  )
  const retrieveInvite = jest.fn(async () => inviteValue)
  const dependencies = new Map<string, unknown>([
    [
      Modules.NOTIFICATION,
      {
        createNotifications,
        listNotifications,
        retrieveNotification,
        updateNotifications,
      },
    ],
    [Modules.USER, { retrieveInvite }],
  ])
  const input = {
    container: {
      resolve: (name: string) => dependencies.get(name),
    },
    event: {
      data: eventData,
      name: eventName,
    },
  } as unknown as Parameters<typeof userInviteHandler>[0]
  return {
    createNotifications,
    input,
    listNotifications,
    retrieveNotification,
    retrieveInvite,
    updateNotifications,
  }
}

describe("administrator invite notification subscriber", () => {
  it.each(["invite.created", "invite.resent"])(
    "creates and verifies a non-PII idempotent notification for %s",
    async (eventName) => {
      const input = fixture({ eventName })

      await expect(userInviteHandler(input.input)).resolves.toBeUndefined()

      const created = input.createNotifications.mock.calls[0]?.[0]?.[0]
      expect(created).toEqual(
        expect.objectContaining({
          channel: "email",
          idempotency_key: expect.stringMatching(
            /^invite-user:invite_01:[a-f0-9]{32}$/
          ),
          receiver_id: "invite_01",
          resource_id: "invite_01",
          resource_type: "invite",
          template: "invite-user",
          to: "operator@example.com",
          trigger_type: eventName,
        })
      )
      expect(created?.idempotency_key).not.toContain("operator@example.com")
      expect(created?.idempotency_key).not.toContain("invite.token")
      expect(created?.data).not.toEqual(
        expect.objectContaining({ metadata: expect.anything() })
      )
      const link = new URL(String(created?.data?.inviteLink))
      expect(link.protocol).toMatch(/^https?:$/)
      expect(link.pathname).toBe("/app/invite")
      expect(link.searchParams.get("token")).toBe("invite.token+value/01")
      expect(input.listNotifications).toHaveBeenCalledWith(
        { idempotency_key: [created?.idempotency_key] },
        { take: 2 }
      )
      expect(input.updateNotifications).toHaveBeenCalledWith({
        data: {
          delivery_state: "sent",
          secret_fields: "redacted",
          version: 1,
        },
        id: "noti_01",
      })
      const finalRow = await input.retrieveNotification("noti_01")
      expect(JSON.stringify(finalRow)).not.toContain("invite.token")
    }
  )

  it("propagates provider failure so the same invite can retry", async () => {
    const input = fixture()
    input.createNotifications.mockRejectedValue(new Error("provider failure"))

    await expect(userInviteHandler(input.input)).rejects.toThrow(
      "provider failure"
    )
    expect(input.listNotifications).not.toHaveBeenCalled()
  })

  it("accepts a replay only after verifying its successful durable row", async () => {
    const input = fixture()
    let submitted: CreateNotificationDTO[] = []
    input.createNotifications.mockImplementation(async (payloads) => {
      submitted = payloads
      return []
    })
    const retained = {
      delivery_state: "sent",
      secret_fields: "redacted",
      version: 1,
    }
    input.listNotifications.mockImplementation(async () =>
      submitted.map((payload) =>
        notificationRow({ ...payload, data: retained })
      )
    )

    await expect(userInviteHandler(input.input)).resolves.toBeUndefined()
    expect(input.updateNotifications).not.toHaveBeenCalled()
  })

  it("rejects a missing durable invite notification", async () => {
    const input = fixture()
    input.listNotifications.mockResolvedValue([])

    await expect(userInviteHandler(input.input)).rejects.toThrow(
      "Notification delivery readback is malformed"
    )
  })

  it.each([
    ["mismatched invite", { id: "invite_02" }],
    ["invalid email", { email: "operator" }],
    ["accepted invite", { accepted: true }],
    ["expired invite", { expires_at: "2020-01-01T00:00:00.000Z" }],
    ["unsafe token", { token: "token with space" }],
  ])("rejects a %s", async (_label, overrides) => {
    const input = fixture({ inviteValue: invite(overrides) })

    await expect(userInviteHandler(input.input)).rejects.toThrow(
      "Invite notification projection is malformed"
    )
    expect(input.createNotifications).not.toHaveBeenCalled()
  })

  it("rejects a malformed event before retrieving the invite", async () => {
    const input = fixture({ eventData: { id: false } })

    await expect(userInviteHandler(input.input)).rejects.toThrow(
      "Invite notification event is malformed"
    )
    expect(input.retrieveInvite).not.toHaveBeenCalled()
  })

  it("rejects an unexpected event name", async () => {
    const input = fixture({ eventName: "invite.deleted" })

    await expect(userInviteHandler(input.input)).rejects.toThrow(
      "Invite notification event is malformed"
    )
    expect(input.retrieveInvite).not.toHaveBeenCalled()
  })
})
