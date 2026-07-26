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
          city: "Buffalo",
          country: "US",
          county: "Erie",
          rate: "0.0635",
          rate_city: "0.01",
          rate_county: "0.0175",
          rate_special: "0.0025",
          rate_state: "0.035",
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
      jurisdiction: null,
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
