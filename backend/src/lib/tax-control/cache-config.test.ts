import {
  resolveTaxCacheConfig,
  TAX_CACHE_CONFIG_DEFAULTS,
  validateTaxCacheConfig,
} from "./cache-config";

describe("tax cache configuration", () => {
  it("uses bounded defaults when cache settings are absent", () => {
    expect(resolveTaxCacheConfig({})).toEqual(TAX_CACHE_CONFIG_DEFAULTS);
  });

  it("accepts explicit bounded integer settings", () => {
    expect(
      resolveTaxCacheConfig({
        STRIPE_TAX_QUOTE_CACHE_MAX_ENTRIES: "1000",
        STRIPE_TAX_QUOTE_TTL_MS: "1800000",
        TAX_RATE_LOOKUP_CACHE_MAX_ENTRIES: "10000",
        TAX_RATE_LOOKUP_CACHE_TTL_MS: "3600000",
      }),
    ).toEqual({
      rateLookupMaxEntries: 10_000,
      rateLookupTtlMs: 3_600_000,
      stripeQuoteMaxEntries: 1_000,
      stripeQuoteTtlMs: 1_800_000,
    });
  });

  it.each([
    ["TAX_RATE_LOOKUP_CACHE_TTL_MS", ""],
    ["TAX_RATE_LOOKUP_CACHE_TTL_MS", "999"],
    ["TAX_RATE_LOOKUP_CACHE_TTL_MS", "3600001"],
    ["TAX_RATE_LOOKUP_CACHE_MAX_ENTRIES", "0"],
    ["TAX_RATE_LOOKUP_CACHE_MAX_ENTRIES", "10001"],
    ["STRIPE_TAX_QUOTE_TTL_MS", "1000.5"],
    ["STRIPE_TAX_QUOTE_TTL_MS", "1800001"],
    ["STRIPE_TAX_QUOTE_CACHE_MAX_ENTRIES", "NaN"],
    ["STRIPE_TAX_QUOTE_CACHE_MAX_ENTRIES", "1001"],
  ])("rejects an invalid %s setting", (name, value) => {
    expect(() => resolveTaxCacheConfig({ [name]: value })).toThrow(
      `${name} must be an integer between`,
    );
  });

  it("does not echo a malformed setting value", () => {
    expect.assertions(1);
    const malformedValue = "sensitive-cache-value";
    try {
      resolveTaxCacheConfig({
        TAX_RATE_LOOKUP_CACHE_TTL_MS: malformedValue,
      });
    } catch (error) {
      expect(String(error)).not.toContain(malformedValue);
    }
  });

  it("validates programmatic provider configuration", () => {
    expect(() =>
      validateTaxCacheConfig({
        ...TAX_CACHE_CONFIG_DEFAULTS,
        stripeQuoteMaxEntries: Number.POSITIVE_INFINITY,
      }),
    ).toThrow("STRIPE_TAX_QUOTE_CACHE_MAX_ENTRIES");
  });
});
