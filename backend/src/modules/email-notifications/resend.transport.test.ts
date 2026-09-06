import type { Logger, NotificationTypes } from "@medusajs/framework/types"

import {
  RESEND_NOTIFICATION_TIMEOUT_MS,
  ResendNotificationService,
} from "./services/resend"

const notification = (): NotificationTypes.ProviderSendNotificationDTO => ({
  channel: "email",
  data: {
    emailOptions: { subject: "Refund issued for order #42" },
    formattedAmount: "$5.00",
    referenceLabel: "order #42",
  },
  provider_data: { idempotency_key: "refund-issued:refund_transport_01" },
  template: "refund-issued",
  to: "customer@example.test",
})

const fixture = () => {
  const logger = {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  }
  const provider = new ResendNotificationService(
    { logger: logger as unknown as Logger },
    { api_key: "re_transport_test", from: "store@example.test" }
  )
  return { logger, provider }
}

describe("Resend notification SDK transport", () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>
  let consoleError: jest.SpiedFunction<typeof console.error>

  beforeEach(() => {
    // Exercise production SDK logging without permitting any real email request.
    jest.replaceProperty(process, "env", {
      ...process.env,
      NODE_ENV: "production",
      RESEND_BASE_URL: "https://api.resend.com",
    })
    fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Unexpected email transport request"))
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it("renders the actual template and forwards only the email contract", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ id: "email_transport_01" }))
    const input = fixture()
    const message = notification()
    const original = structuredClone(message)

    await expect(input.provider.send(message)).resolves.toEqual({
      id: "email_transport_01",
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe("https://api.resend.com/emails")
    expect(options?.method).toBe("POST")
    expect(options?.signal).toBeInstanceOf(AbortSignal)
    expect(options?.signal?.aborted).toBe(false)
    expect(new Headers(options?.headers).get("Idempotency-Key")).toBe(
      "refund-issued:refund_transport_01"
    )
    const body: unknown = JSON.parse(String(options?.body))
    expect(body).toEqual({
      from: "store@example.test",
      html: expect.stringContaining("$5.00"),
      subject: "Refund issued for order #42",
      to: "customer@example.test",
    })
    expect(String(options?.body)).toContain("order #42")
    expect(message).toEqual(original)
    expect(JSON.stringify(input.logger.info.mock.calls)).not.toContain(
      "customer@example.test"
    )
    expect(consoleError).not.toHaveBeenCalled()
  })

  it.each([
    [409, "concurrent_idempotent_requests"],
    [409, "invalid_idempotent_request"],
    [429, "rate_limit_exceeded"],
  ])(
    "propagates %s %s without an SDK retry or provider detail",
    async (status, name) => {
      fetchMock.mockResolvedValueOnce(
        Response.json(
          {
            message: "private-provider-diagnostic customer@example.test",
            name,
          },
          { status, headers: { "Retry-After": "1" } }
        )
      )
      const input = fixture()

      await expect(input.provider.send(notification())).rejects.toMatchObject({
        message: `Failed to send "refund-issued" email (${name})`,
      })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(input.logger.info).not.toHaveBeenCalled()
      expect(input.logger.error).not.toHaveBeenCalled()
      expect(consoleError).not.toHaveBeenCalled()
    }
  )

  it("reuses the same payload and key when the caller retries a lost response", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("private-provider-response-lost"))
      .mockResolvedValueOnce(Response.json({ id: "email_replayed_01" }))
    const input = fixture()

    await expect(input.provider.send(notification())).rejects.toMatchObject({
      message: 'Failed to send "refund-issued" email (application_error)',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(input.logger.info).not.toHaveBeenCalled()

    await expect(input.provider.send(notification())).resolves.toEqual({
      id: "email_replayed_01",
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const first = fetchMock.mock.calls[0]?.[1]
    const retry = fetchMock.mock.calls[1]?.[1]
    expect(retry?.body).toBe(first?.body)
    for (const options of [first, retry]) {
      expect(new Headers(options?.headers).get("Idempotency-Key")).toBe(
        "refund-issued:refund_transport_01"
      )
    }
    expect(input.logger.info).toHaveBeenCalledTimes(1)
    expect(consoleError).not.toHaveBeenCalled()
  })

  it("forwards the deadline abort and fails once without exposing its reason", async () => {
    const controller = new AbortController()
    const timeout = jest
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(controller.signal)
    let markRequested = (): void => {
      throw new Error("The request observer was not initialized")
    }
    const requested = new Promise<void>((resolve) => {
      markRequested = resolve
    })
    fetchMock.mockImplementationOnce(
      async (_url, options) =>
        new Promise<Response>((_resolve, reject) => {
          markRequested()
          const signal = options?.signal
          if (!signal) {
            reject(new Error("The SDK omitted the request signal"))
            return
          }
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          })
        })
    )
    const input = fixture()
    const send = input.provider.send(notification())
    const rejected = expect(send).rejects.toMatchObject({
      message: 'Failed to send "refund-issued" email (application_error)',
    })

    await requested
    expect(timeout).toHaveBeenCalledWith(RESEND_NOTIFICATION_TIMEOUT_MS)
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal)
    controller.abort(new Error("private-provider-abort-reason"))
    await rejected

    expect(controller.signal.aborted).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(input.logger.info).not.toHaveBeenCalled()
    expect(consoleError).not.toHaveBeenCalled()
  })
})
