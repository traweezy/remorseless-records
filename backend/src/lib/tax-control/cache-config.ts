export type TaxCacheConfig = {
  rateLookupMaxEntries: number
  rateLookupTtlMs: number
  stripeQuoteMaxEntries: number
  stripeQuoteTtlMs: number
}

export type TaxCacheProviderOptions = {
  rateCacheMaxEntries?: unknown
  rateCacheTtlMs?: unknown
  stripeQuoteCacheMaxEntries?: unknown
  stripeQuoteTtlMs?: unknown
}

type TaxCacheConfigKey = keyof TaxCacheConfig

type TaxCacheSetting = {
  defaultValue: number
  environmentName: string
  maximum: number
  minimum: number
}

export const TAX_CACHE_CONFIG_DEFAULTS: Readonly<TaxCacheConfig> = {
  rateLookupMaxEntries: 2_048,
  rateLookupTtlMs: 5 * 60 * 1_000,
  stripeQuoteMaxEntries: 256,
  stripeQuoteTtlMs: 30 * 60 * 1_000,
}

const TAX_CACHE_SETTINGS: Readonly<Record<TaxCacheConfigKey, TaxCacheSetting>> =
  {
    rateLookupMaxEntries: {
      defaultValue: TAX_CACHE_CONFIG_DEFAULTS.rateLookupMaxEntries,
      environmentName: "TAX_RATE_LOOKUP_CACHE_MAX_ENTRIES",
      maximum: 10_000,
      minimum: 1,
    },
    rateLookupTtlMs: {
      defaultValue: TAX_CACHE_CONFIG_DEFAULTS.rateLookupTtlMs,
      environmentName: "TAX_RATE_LOOKUP_CACHE_TTL_MS",
      maximum: 60 * 60 * 1_000,
      minimum: 1_000,
    },
    stripeQuoteMaxEntries: {
      defaultValue: TAX_CACHE_CONFIG_DEFAULTS.stripeQuoteMaxEntries,
      environmentName: "STRIPE_TAX_QUOTE_CACHE_MAX_ENTRIES",
      maximum: 1_000,
      minimum: 1,
    },
    stripeQuoteTtlMs: {
      defaultValue: TAX_CACHE_CONFIG_DEFAULTS.stripeQuoteTtlMs,
      environmentName: "STRIPE_TAX_QUOTE_TTL_MS",
      maximum: 30 * 60 * 1_000,
      minimum: 1_000,
    },
  }

const assertBoundedInteger = (
  value: unknown,
  setting: TaxCacheSetting
): number => {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < setting.minimum ||
    value > setting.maximum
  ) {
    throw new Error(
      `${setting.environmentName} must be an integer between ${setting.minimum} and ${setting.maximum}`
    )
  }
  return value
}

const parseEnvironmentSetting = (
  value: string | undefined,
  setting: TaxCacheSetting
): number => {
  if (value === undefined) {
    return setting.defaultValue
  }
  const trimmed = value.trim()
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new Error(
      `${setting.environmentName} must be an integer between ${setting.minimum} and ${setting.maximum}`
    )
  }
  return assertBoundedInteger(Number(trimmed), setting)
}

export const validateTaxCacheConfig = (
  config: Record<TaxCacheConfigKey, unknown>
): TaxCacheConfig => ({
  rateLookupMaxEntries: assertBoundedInteger(
    config.rateLookupMaxEntries,
    TAX_CACHE_SETTINGS.rateLookupMaxEntries
  ),
  rateLookupTtlMs: assertBoundedInteger(
    config.rateLookupTtlMs,
    TAX_CACHE_SETTINGS.rateLookupTtlMs
  ),
  stripeQuoteMaxEntries: assertBoundedInteger(
    config.stripeQuoteMaxEntries,
    TAX_CACHE_SETTINGS.stripeQuoteMaxEntries
  ),
  stripeQuoteTtlMs: assertBoundedInteger(
    config.stripeQuoteTtlMs,
    TAX_CACHE_SETTINGS.stripeQuoteTtlMs
  ),
})

export const resolveProviderTaxCacheConfig = (
  options: TaxCacheProviderOptions = {}
): TaxCacheConfig =>
  validateTaxCacheConfig({
    rateLookupMaxEntries:
      options.rateCacheMaxEntries ??
      TAX_CACHE_CONFIG_DEFAULTS.rateLookupMaxEntries,
    rateLookupTtlMs:
      options.rateCacheTtlMs ?? TAX_CACHE_CONFIG_DEFAULTS.rateLookupTtlMs,
    stripeQuoteMaxEntries:
      options.stripeQuoteCacheMaxEntries ??
      TAX_CACHE_CONFIG_DEFAULTS.stripeQuoteMaxEntries,
    stripeQuoteTtlMs:
      options.stripeQuoteTtlMs ?? TAX_CACHE_CONFIG_DEFAULTS.stripeQuoteTtlMs,
  })

export const formatTaxCacheConfigLog = (config: TaxCacheConfig): string =>
  `Tax local caches configured (rate_ttl_ms=${config.rateLookupTtlMs}, rate_max_entries=${config.rateLookupMaxEntries}, stripe_quote_ttl_ms=${config.stripeQuoteTtlMs}, stripe_quote_max_entries=${config.stripeQuoteMaxEntries}).`

export const resolveTaxCacheConfig = (
  environment: NodeJS.ProcessEnv = process.env
): TaxCacheConfig => ({
  rateLookupMaxEntries: parseEnvironmentSetting(
    environment.TAX_RATE_LOOKUP_CACHE_MAX_ENTRIES,
    TAX_CACHE_SETTINGS.rateLookupMaxEntries
  ),
  rateLookupTtlMs: parseEnvironmentSetting(
    environment.TAX_RATE_LOOKUP_CACHE_TTL_MS,
    TAX_CACHE_SETTINGS.rateLookupTtlMs
  ),
  stripeQuoteMaxEntries: parseEnvironmentSetting(
    environment.STRIPE_TAX_QUOTE_CACHE_MAX_ENTRIES,
    TAX_CACHE_SETTINGS.stripeQuoteMaxEntries
  ),
  stripeQuoteTtlMs: parseEnvironmentSetting(
    environment.STRIPE_TAX_QUOTE_TTL_MS,
    TAX_CACHE_SETTINGS.stripeQuoteTtlMs
  ),
})
