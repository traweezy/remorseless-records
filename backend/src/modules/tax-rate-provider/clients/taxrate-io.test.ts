import { fetchTaxRateIo } from "./taxrate-io"

const originalFetch = global.fetch

afterEach(() => {
  global.fetch = originalFetch
  jest.restoreAllMocks()
})

describe("fetchTaxRateIo", () => {
  it("normalizes a decimal rate and exposes the authoritative quota snapshot", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          rate: "0.0635",
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
    expect(result.quota).toMatchObject({
      quota: 100,
      remaining: 81,
      usage: 19,
      usagePercent: 19,
    })
    expect(result.quota?.observedAt).toEqual(expect.any(String))
  })

  it("keeps a valid rate when an older response omits usage data", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ rate_pct: 6.35 }), { status: 200 })
    )

    await expect(
      fetchTaxRateIo({
        apiKey: "secret",
        timeoutMs: 500,
        zip: "06902",
      })
    ).resolves.toEqual({
      quota: null,
      ratePercent: 6.35,
    })
  })

  it("does not expose API keys in upstream errors", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response("quota exhausted", { status: 429 })
    )

    await expect(
      fetchTaxRateIo({
        apiKey: "do-not-log",
        timeoutMs: 500,
        zip: "06902",
      })
    ).rejects.toThrow("Taxrate.io request failed (429)")
  })
})
