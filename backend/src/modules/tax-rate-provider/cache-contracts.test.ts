import {
  parseCachedStripeQuote,
  parseCachedTaxRateIoResult,
  parsePersistedTaxRateIoQuota,
  parseTaxRateIoQuotaSnapshot,
} from "./cache-contracts"

const jurisdiction = {
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
}

const stripeQuote = (nowMs: number) => ({
  expiresAt: nowMs + 30_000,
  result: {
    amountTotal: 2_163,
    calculationId: "taxcalc_01ABC",
    currency: "usd",
    expiresAt: Math.floor((nowMs + 60_000) / 1_000),
    itemTaxByReference: { item_01: 150, item_02: 8 },
    livemode: false,
    shippingTax: 5,
    taxAmountExclusive: 163,
  },
})

describe("tax provider cache contracts", () => {
  it("accepts current and bounded legacy TaxRate.io cache values", () => {
    expect(
      parseCachedTaxRateIoResult(
        JSON.stringify({ jurisdiction, ratePercent: 6.5 })
      )
    ).toEqual({ jurisdiction, quota: null, ratePercent: 6.5 })
    expect(parseCachedTaxRateIoResult("6.5")).toEqual({
      jurisdiction: null,
      quota: null,
      ratePercent: 6.5,
    })
  })

  it.each([
    "101",
    "-1",
    "0x10",
    JSON.stringify({ jurisdiction, ratePercent: "6.5 trailing" }),
    JSON.stringify({
      jurisdiction: {
        ...jurisdiction,
        rate_components: { ...jurisdiction.rate_components, state: 101 },
      },
      ratePercent: 6.5,
    }),
    JSON.stringify({
      jurisdiction: { ...jurisdiction, country_code: "not-a-country" },
      ratePercent: 6.5,
    }),
  ])("rejects malformed TaxRate.io cache value %p", (value) => {
    expect(parseCachedTaxRateIoResult(value)).toBeNull()
  })

  it("accepts a coherent TaxRate.io quota snapshot", () => {
    expect(
      parseTaxRateIoQuotaSnapshot({
        observedAt: "2026-08-30T12:00:00-04:00",
        quota: 100,
        remaining: 75,
        usage: 25,
        usagePercent: 25,
      })
    ).toEqual({
      observedAt: "2026-08-30T16:00:00.000Z",
      quota: 100,
      remaining: 75,
      usage: 25,
      usagePercent: 25,
    })
  })

  it.each([
    {
      observedAt: "not-a-date",
      quota: 100,
      remaining: 75,
      usage: 25,
      usagePercent: 25,
    },
    {
      observedAt: "2026-08-30T16:00:00.000Z",
      quota: "100",
      remaining: 75,
      usage: 25,
      usagePercent: 25,
    },
    {
      observedAt: "2026-08-30T16:00:00.000Z",
      quota: 100,
      remaining: 76,
      usage: 25,
      usagePercent: 25,
    },
    {
      observedAt: "2026-08-30T16:00:00.000Z",
      quota: 100,
      remaining: 0,
      usage: 101,
      usagePercent: 101,
    },
  ])("rejects incoherent quota snapshot %p", (value) => {
    expect(parseTaxRateIoQuotaSnapshot(value)).toBeNull()
  })

  it("normalizes a complete persisted quota projection", () => {
    expect(
      parsePersistedTaxRateIoQuota({
        observed_at: new Date("2026-08-30T16:00:00.000Z"),
        provider: "taxrate_io",
        quota: "100",
        remaining: { value: "75" },
        source: "checkout_lookup",
        usage: 25,
        usage_percent: "25",
      })
    ).toEqual({
      observedAt: "2026-08-30T16:00:00.000Z",
      quota: 100,
      remaining: 75,
      source: "checkout_lookup",
      usage: 25,
      usagePercent: 25,
    })
  })

  it.each([
    { provider: "stripe_tax", source: "checkout_lookup" },
    { provider: "taxrate_io", source: "untrusted" },
    { provider: "taxrate_io", source: "checkout_lookup", remaining: 76 },
  ])("rejects malformed persisted quota projection %p", (override) => {
    const validProjection = {
      observed_at: new Date("2026-08-30T16:00:00.000Z"),
      provider: "taxrate_io",
      quota: 100,
      remaining: 75,
      source: "checkout_lookup",
      usage: 25,
      usage_percent: 25,
    }
    expect(
      parsePersistedTaxRateIoQuota({
        ...validProjection,
        ...override,
      })
    ).toBeNull()
  })

  it("reconstructs a complete Stripe Tax quote from cache", () => {
    const nowMs = Date.parse("2026-08-30T16:00:00.000Z")
    expect(
      parseCachedStripeQuote(JSON.stringify(stripeQuote(nowMs)), nowMs)
    ).toEqual(stripeQuote(nowMs))
  })

  it.each([
    (quote: ReturnType<typeof stripeQuote>) => ({ ...quote, expiresAt: 0 }),
    (quote: ReturnType<typeof stripeQuote>) => ({
      ...quote,
      result: { ...quote.result, currency: "USD" },
    }),
    (quote: ReturnType<typeof stripeQuote>) => ({
      ...quote,
      result: {
        ...quote.result,
        itemTaxByReference: {
          ...quote.result.itemTaxByReference,
          item_03: "1",
        },
      },
    }),
    (quote: ReturnType<typeof stripeQuote>) => ({
      ...quote,
      result: { ...quote.result, taxAmountExclusive: 164 },
    }),
    (quote: ReturnType<typeof stripeQuote>) => ({
      ...quote,
      result: { ...quote.result, livemode: "false" },
    }),
  ])("rejects a malformed Stripe Tax cache projection", (mutate) => {
    const nowMs = Date.parse("2026-08-30T16:00:00.000Z")
    expect(
      parseCachedStripeQuote(JSON.stringify(mutate(stripeQuote(nowMs))), nowMs)
    ).toBeNull()
  })
})
