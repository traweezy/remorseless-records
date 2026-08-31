import type { Logger, NotificationTypes } from "@medusajs/framework/types"

import {
  RESEND_NOTIFICATION_TIMEOUT_MS,
  ResendNotificationService,
} from "./services/resend"

type ResendClientOverride = {
  resendClient: {
    emails: {
      send: jest.Mock
    }
  }
}

const refundNotification = (
  overrides: Partial<NotificationTypes.ProviderSendNotificationDTO> = {}
): NotificationTypes.ProviderSendNotificationDTO => ({
  channel: "email",
  data: {
    emailOptions: { subject: "Refund issued for order #42" },
    formattedAmount: "$5.00",
    referenceLabel: "order #42",
  },
  provider_data: {
    idempotency_key: "refund-issued:refund_01",
  },
  template: "refund-issued",
  to: "customer@example.com",
  ...overrides,
})

const inviteNotification = (
  overrides: Partial<NotificationTypes.ProviderSendNotificationDTO> = {}
): NotificationTypes.ProviderSendNotificationDTO => ({
  channel: "email",
  data: {
    emailOptions: { subject: "Administrator invite" },
    inviteLink: "https://backend.example.com/app/invite?token=token_01",
    preview: "Your administrator invite is ready.",
  },
  provider_data: {
    idempotency_key: "invite-user:invite_01:abcdef0123456789",
  },
  template: "invite-user",
  to: "operator@example.com",
  ...overrides,
})

const fixture = () => {
  const logger = {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  }
  const provider = new ResendNotificationService(
    { logger: logger as unknown as Logger },
    { api_key: "re_unit_test", from: "store@example.com" }
  )
  const send: jest.Mock = jest.fn(async (..._args: unknown[]) => ({
    data: { id: "email_01" },
    error: null,
  }))
  ;(provider as unknown as ResendClientOverride).resendClient = {
    emails: { send },
  }
  return { logger, provider, send }
}

describe("Resend notification provider", () => {
  it("carries sensitive-email idempotency through the provider deadline", async () => {
    const input = fixture()

    await expect(input.provider.send(refundNotification())).resolves.toEqual({
      id: "email_01",
    })

    expect(input.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: "customer@example.com" }),
      expect.objectContaining({
        idempotencyKey: "refund-issued:refund_01",
        signal: expect.any(AbortSignal),
      })
    )
    const requestOptions = input.send.mock.calls[0]?.[1] as
      | { signal?: AbortSignal }
      | undefined
    const signal = requestOptions?.signal
    expect(signal).toBeInstanceOf(AbortSignal)
    if (!signal) {
      throw new Error("Expected a Resend request deadline signal")
    }
    expect(signal.aborted).toBe(false)
    expect(RESEND_NOTIFICATION_TIMEOUT_MS).toBe(5_000)
    expect(input.logger.info).toHaveBeenCalledWith(
      expect.not.stringContaining("customer@example.com")
    )
  })

  it("rejects a sensitive email without provider idempotency", async () => {
    const input = fixture()

    await expect(
      input.provider.send(refundNotification({ provider_data: null }))
    ).rejects.toThrow("requires provider idempotency")
    expect(input.send).not.toHaveBeenCalled()
  })

  it("requires provider idempotency for administrator invites", async () => {
    const input = fixture()

    await expect(
      input.provider.send(inviteNotification({ provider_data: null }))
    ).rejects.toThrow("requires provider idempotency")
    expect(input.send).not.toHaveBeenCalled()
  })

  it("redacts resolved provider error details", async () => {
    const input = fixture()
    input.send.mockResolvedValue({
      data: null,
      error: {
        message: "Rejected customer@example.com for private reason",
        name: "validation_error",
      },
    })

    let caughtError: unknown
    try {
      await input.provider.send(refundNotification())
    } catch (error) {
      caughtError = error
    }

    expect(caughtError).toBeInstanceOf(Error)
    const message = (caughtError as Error).message
    expect(message).toContain("email (validation_error)")
    expect(message).not.toContain("customer@example.com")
    expect(input.send).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["missing data", { data: null }],
    [
      "unexpected email option",
      {
        data: {
          emailOptions: {
            bcc: "private@example.com",
            subject: "Refund issued",
          },
          formattedAmount: "$5.00",
          referenceLabel: "order #42",
        },
      },
    ],
    ["multiple recipients", { to: ["one@example.com", "two@example.com"] }],
    ["invalid recipient", { to: "customer" }],
    ["sender override", { from: "other@example.com" }],
    [
      "attachment",
      {
        attachments: [
          {
            content: "private",
            filename: "private.txt",
          },
        ],
      },
    ],
    ["unsupported channel", { channel: "sms" }],
    ["unsupported template", { template: "untrusted-template" }],
  ])("rejects %s before contacting Resend", async (_label, overrides) => {
    const input = fixture()

    await expect(
      input.provider.send(
        refundNotification(
          overrides as unknown as Partial<NotificationTypes.ProviderSendNotificationDTO>
        )
      )
    ).rejects.toThrow()
    expect(input.send).not.toHaveBeenCalled()
  })

  it.each([
    { data: null, error: null },
    { data: {}, error: null },
    { data: { id: false }, error: null },
    { data: { id: "email_01", unexpected: true }, error: null },
  ])("rejects a malformed resolved provider response", async (response) => {
    const input = fixture()
    input.send.mockResolvedValue(response)

    await expect(input.provider.send(refundNotification())).rejects.toThrow(
      "provider_response"
    )
    expect(input.logger.info).not.toHaveBeenCalled()
  })

  it("sends only the allowlisted Resend message fields", async () => {
    const input = fixture()

    await input.provider.send(inviteNotification())

    expect(input.send.mock.calls[0]?.[0]).toEqual({
      from: "store@example.com",
      react: expect.anything(),
      subject: "Administrator invite",
      to: "operator@example.com",
    })
  })

  it("rejects malformed provider configuration without exposing it", () => {
    const logger = {
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    }

    expect(
      () =>
        new ResendNotificationService(
          { logger: logger as unknown as Logger },
          { api_key: "", from: "not-an-email" }
        )
    ).toThrow("configuration is invalid")
  })
})
