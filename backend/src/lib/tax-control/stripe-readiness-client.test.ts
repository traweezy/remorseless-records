import {
  readStripeTaxReadiness,
  StripeTaxReadinessClientError,
  type StripeTaxReadinessClient,
} from "./stripe-readiness-client"

const settings = {
  defaults: {
    provider: "stripe",
    tax_behavior: "exclusive",
    tax_code: "txcd_99999999",
  },
  head_office: { address: { country: "US" } },
  livemode: false,
  object: "tax.settings",
  status: "active",
  status_details: { active: {} },
}

const registrations = {
  data: [
    {
      id: "taxreg_example",
      livemode: false,
      object: "tax.registration",
      status: "active",
    },
  ],
  has_more: false,
  object: "list",
}

const clientWith = ({
  list = jest.fn().mockResolvedValue(registrations),
  retrieve = jest.fn().mockResolvedValue(settings),
}: {
  list?: jest.Mock
  retrieve?: jest.Mock
} = {}): StripeTaxReadinessClient =>
  ({
    tax: {
      registrations: { list },
      settings: { retrieve },
    },
  }) as unknown as StripeTaxReadinessClient

const read = (
  client: StripeTaxReadinessClient,
  overrides: Partial<Parameters<typeof readStripeTaxReadiness>[0]> = {}
) =>
  readStripeTaxReadiness({
    client,
    timeoutMs: 8_000,
    ...overrides,
  })

describe("Stripe Tax readiness client", () => {
  it("reads a validated readiness snapshot with bounded request options", async () => {
    const client = clientWith()

    await expect(read(client)).resolves.toEqual({
      activeRegistrationCount: 1,
      hasHeadOffice: true,
      livemode: false,
      missingFields: [],
      provider: "stripe",
      status: "active",
      taxBehavior: "exclusive",
      taxCode: "txcd_99999999",
    })
    expect(client.tax.settings.retrieve).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        maxNetworkRetries: 0,
        timeout: expect.any(Number),
      })
    )
    expect(client.tax.registrations.list).toHaveBeenCalledWith(
      { limit: 100, status: "active" },
      expect.objectContaining({
        maxNetworkRetries: 0,
        timeout: expect.any(Number),
      })
    )
  })

  it("gives both concurrent reads the same decreasing deadline", async () => {
    const now = jest
      .spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_100)
      .mockReturnValueOnce(1_200)
    const client = clientWith()

    try {
      await read(client)
    } finally {
      now.mockRestore()
    }

    expect(
      (client.tax.settings.retrieve as jest.Mock).mock.calls[0]?.[1]
    ).toMatchObject({ timeout: 7_900 })
    expect(
      (client.tax.registrations.list as jest.Mock).mock.calls[0]?.[1]
    ).toMatchObject({ timeout: 7_800 })
  })

  it.each([
    [
      "settings",
      "transport",
      {
        retrieve: jest
          .fn()
          .mockRejectedValueOnce({ type: "StripeConnectionError" })
          .mockResolvedValueOnce(settings),
      },
    ],
    [
      "registrations",
      "status",
      {
        list: jest
          .fn()
          .mockRejectedValueOnce({ statusCode: 503 })
          .mockResolvedValueOnce(registrations),
      },
    ],
  ] as const)(
    "retries one transient %s read with sanitized %s telemetry",
    async (operation, reason, overrides) => {
      const onRetry = jest.fn()
      const client = clientWith(overrides)

      await expect(read(client, { onRetry })).resolves.toMatchObject({
        activeRegistrationCount: 1,
      })
      expect(onRetry).toHaveBeenCalledWith({
        attempt: 2,
        operation,
        reason,
        totalAttempts: 2,
      })
    }
  )

  it("keeps rate limits single-attempt even when Stripe requests a retry", async () => {
    const onRetry = jest.fn()
    const retrieve = jest.fn().mockRejectedValue({
      headers: { "stripe-should-retry": "true" },
      message: "provider detail must stay private",
      statusCode: 429,
    })

    await expect(read(clientWith({ retrieve }), { onRetry })).rejects.toEqual(
      new StripeTaxReadinessClientError("provider_unavailable")
    )
    expect(retrieve).toHaveBeenCalledTimes(1)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it("honors Stripe's explicit retry opt-out", async () => {
    const onRetry = jest.fn()
    const list = jest.fn().mockRejectedValue({
      headers: { "stripe-should-retry": "false" },
      statusCode: 503,
    })

    await expect(read(clientWith({ list }), { onRetry })).rejects.toMatchObject(
      { code: "provider_unavailable" }
    )
    expect(list).toHaveBeenCalledTimes(1)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it.each([
    [{ ...settings, object: "account" }],
    [{ ...settings, status: "enabled" }],
    [{ ...settings, defaults: { ...settings.defaults, provider: "unknown" } }],
    [{ ...settings, defaults: { ...settings.defaults, tax_code: "invalid" } }],
    [
      {
        ...settings,
        status_details: { pending: { missing_fields: ["head_office"] } },
      },
    ],
    [
      {
        ...settings,
        status_details: {
          pending: { missing_fields: ["safe", "safe"] },
        },
      },
    ],
  ])("rejects malformed settings", async (response) => {
    const retrieve = jest.fn().mockResolvedValue(response)

    await expect(read(clientWith({ retrieve }))).rejects.toMatchObject({
      code: "invalid_response",
    })
  })

  it.each([
    [{ ...registrations, object: "tax.registration" }],
    [{ ...registrations, has_more: true }],
    [
      {
        ...registrations,
        data: [{ ...registrations.data[0], livemode: true }],
      },
    ],
    [
      {
        ...registrations,
        data: [{ ...registrations.data[0], status: "scheduled" }],
      },
    ],
    [
      {
        ...registrations,
        data: [registrations.data[0], registrations.data[0]],
      },
    ],
  ])("rejects malformed or incomplete registration lists", async (response) => {
    const list = jest.fn().mockResolvedValue(response)

    await expect(read(clientWith({ list }))).rejects.toMatchObject({
      code: "invalid_response",
    })
  })

  it("rejects oversized registration lists", async () => {
    const list = jest.fn().mockResolvedValue({
      ...registrations,
      data: Array.from({ length: 101 }, (_, index) => ({
        ...registrations.data[0],
        id: `taxreg_${index}`,
      })),
    })

    await expect(read(clientWith({ list }))).rejects.toMatchObject({
      code: "invalid_response",
    })
  })

  it("rejects invalid timeouts before contacting Stripe", async () => {
    const client = clientWith()

    await expect(read(client, { timeoutMs: 0 })).rejects.toMatchObject({
      code: "invalid_request",
    })
    expect(client.tax.settings.retrieve).not.toHaveBeenCalled()
    expect(client.tax.registrations.list).not.toHaveBeenCalled()
  })

  it("redacts provider errors from the typed failure", async () => {
    const secret = "sk_test_private_provider_message"
    const retrieve = jest.fn().mockRejectedValue({
      message: secret,
      statusCode: 400,
    })

    try {
      await read(clientWith({ retrieve }))
      throw new Error("Expected the readiness read to fail")
    } catch (error) {
      expect(error).toBeInstanceOf(StripeTaxReadinessClientError)
      expect(String(error)).not.toContain(secret)
      expect(error).toMatchObject({ code: "provider_rejected" })
    }
  })
})
