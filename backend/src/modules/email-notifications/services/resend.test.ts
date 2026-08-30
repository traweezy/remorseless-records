import type { Logger, NotificationTypes } from "@medusajs/framework/types"

import {
  RESEND_NOTIFICATION_TIMEOUT_MS,
  ResendNotificationService,
} from "./resend"

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
})
