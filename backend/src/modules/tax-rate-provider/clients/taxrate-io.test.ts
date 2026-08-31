import { fetchTaxRateIo, TaxRateIoClientError } from "./taxrate-io"

const originalFetch = global.fetch

afterEach(() => {
  global.fetch = originalFetch
  jest.restoreAllMocks()
})

const rejectedClientError = async (
  operation: Promise<unknown>
): Promise<TaxRateIoClientError> => {
  try {
    await operation
  } catch (error: unknown) {
    if (error instanceof TaxRateIoClientError) {
      return error
    }
    throw error
  }

  throw new Error("Expected TaxRate.io client operation to fail")
}

describe("fetchTaxRateIo", () => {
  it("normalizes a decimal rate and exposes the authoritative quota snapshot", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          city: "Buffalo",
          country: "US",
          county: "Erie",
          rate: "6.35",
          rate_city: "1",
          rate_county: "1.75",
          rate_pct: "0.0635",
          rate_special: "0.25",
          rate_state: "3.5",
          state: "NY",
          tax_name: "Sales Tax",
          usage_data: {
            quota: "100",
            usage: "19",
            usage_pct: "19",
          },
        }),
        { status: 200 }
      )
    )

    const result = await fetchTaxRateIo({
      apiKey: "secret",
      timeoutMs: 500,
      zip: "06902",
    })

    expect(result.ratePercent).toBe(6.35)
    expect(result.jurisdiction).toEqual({
      city: "Buffalo",
      country_code: "US",
      county: "Erie",
      level: "county",
      name: "Erie",
      rate_components: {
        city: 1,
        county: 1.75,
        special: 0.25,
        state: 3.5,
      },
      state: "NY",
      tax_name: "Sales Tax",
    })
    expect(result.quota).toMatchObject({
      quota: 100,
      remaining: 81,
      usage: 19,
      usagePercent: 19,
    })
    expect(result.quota?.observedAt).toEqual(expect.any(String))
  })

  it("keeps a valid rate when an older response omits usage data", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ rate_pct: 0.0635 }), { status: 200 })
      )

    await expect(
      fetchTaxRateIo({
        apiKey: "secret",
        timeoutMs: 500,
        zip: "06902",
      })
    ).resolves.toEqual({
      jurisdiction: null,
      quota: null,
      ratePercent: 6.35,
    })
  })

  it.each([
    [{ rate: 1 }, 1],
    [{ rate_pct: 0.01 }, 1],
  ])(
    "keeps percent and fractional fields semantically distinct",
    async (payload, expected) => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(payload), { status: 200 })
        )

      await expect(
        fetchTaxRateIo({
          apiKey: "secret",
          timeoutMs: 500,
          zip: "06902",
        })
      ).resolves.toMatchObject({ ratePercent: expected })
    }
  )

  it("rejects contradictory percent and fractional fields", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ rate: 6.35, rate_pct: 0.07 }), {
        status: 200,
      })
    )

    const error = await rejectedClientError(
      fetchTaxRateIo({
        apiKey: "secret",
        timeoutMs: 500,
        zip: "06902",
      })
    )

    expect(error).toMatchObject({ code: "invalid_response" })
  })

  it("retries one transient status under the same request boundary", async () => {
    const onRetry = jest.fn()
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ rate_pct: 0.0635 }), { status: 200 })
      )

    await expect(
      fetchTaxRateIo({
        apiKey: "secret",
        onRetry,
        timeoutMs: 500,
        zip: "06902",
      })
    ).resolves.toMatchObject({ ratePercent: 6.35 })
    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledWith({
      attempt: 2,
      reason: "status",
      totalAttempts: 2,
    })
  })

  it("retries one transient transport failure", async () => {
    const onRetry = jest.fn()
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(new TypeError("socket failed with do-not-log"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ rate_pct: 0.0635 }), { status: 200 })
      )

    await expect(
      fetchTaxRateIo({
        apiKey: "do-not-log",
        onRetry,
        timeoutMs: 500,
        zip: "06902",
      })
    ).resolves.toMatchObject({ ratePercent: 6.35 })
    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledWith({
      attempt: 2,
      reason: "transport",
      totalAttempts: 2,
    })
  })

  it("bounds transient provider failures to two attempts", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response("unavailable", { status: 503 }))

    const error = await rejectedClientError(
      fetchTaxRateIo({
        apiKey: "secret",
        timeoutMs: 500,
        zip: "06902",
      })
    )

    expect(error).toMatchObject({
      code: "provider_unavailable",
      message: "Tax rate lookup failed (provider_unavailable)",
    })
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it("does not retry or expose details from a rejected request", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response("quota exhausted", { status: 429 }))

    const error = await rejectedClientError(
      fetchTaxRateIo({
        apiKey: "do-not-log",
        timeoutMs: 500,
        zip: "06902",
      })
    )

    expect(error).toMatchObject({
      code: "provider_rejected",
      message: "Tax rate lookup failed (provider_rejected)",
    })
    expect(error.message).not.toContain("do-not-log")
    expect(error.message).not.toContain("quota exhausted")
    expect(error.message).not.toContain("429")
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it("enforces one deadline across the complete retry boundary", async () => {
    global.fetch = jest.fn(
      async (
        _input: string | URL | Request,
        init?: RequestInit
      ): Promise<Response> =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal
          if (!signal) {
            reject(new Error("Expected a deadline signal"))
            return
          }
          const rejectForAbort = (): void => reject(signal.reason)
          if (signal.aborted) {
            rejectForAbort()
            return
          }
          signal.addEventListener("abort", rejectForAbort, { once: true })
        })
    )

    const error = await rejectedClientError(
      fetchTaxRateIo({
        apiKey: "secret",
        timeoutMs: 20,
        zip: "06902",
      })
    )

    expect(error).toMatchObject({ code: "deadline_exceeded" })
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it.each(["not-a-rate", "6.35 trailing-data", -0.01, 101])(
    "rejects invalid rate %p without retrying",
    async (rate) => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ rate }), { status: 200 })
        )

      const error = await rejectedClientError(
        fetchTaxRateIo({
          apiKey: "secret",
          timeoutMs: 500,
          zip: "06902",
        })
      )

      expect(error).toMatchObject({ code: "invalid_response" })
      expect(global.fetch).toHaveBeenCalledTimes(1)
    }
  )

  it("discards an invalid optional breakdown component", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ rate_pct: 0.0635, rate_state: 101, state: "NY" }),
          { status: 200 }
        )
      )

    await expect(
      fetchTaxRateIo({
        apiKey: "secret",
        timeoutMs: 500,
        zip: "06902",
      })
    ).resolves.toMatchObject({
      jurisdiction: {
        rate_components: { state: null },
      },
      ratePercent: 6.35,
    })
  })
})
