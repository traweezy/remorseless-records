import type {
  ITaxProvider,
  ItemTaxCalculationLine,
  ItemTaxLineDTO,
  Logger,
  ShippingTaxCalculationLine,
  ShippingTaxLineDTO,
  TaxCalculationContext,
} from '@medusajs/framework/types'

import { fetchTaxRateIo } from './clients/taxrate-io'

type TaxRateLookupProviderOptions = {
  provider: 'taxrate_io'
  apiKey: string
  mode?: 'zip' | 'address'
  timeoutMs?: number
}

type InjectedDependencies = {
  logger: Logger
}

type CachedRate = {
  ratePercent: number
  expiresAt: number
}

const CACHE_TTL_MS = 10 * 60 * 1000
const DEFAULT_TIMEOUT_MS = 8_000
const rateCache = new Map<string, CachedRate>()

const buildCacheKey = (address: TaxCalculationContext['address']): string | null => {
  const countryCode = address.country_code?.toLowerCase()
  const postalCode = address.postal_code?.trim()

  if (!countryCode || !postalCode) {
    return null
  }

  const provinceCode = address.province_code?.toLowerCase() ?? ''
  return `${countryCode}:${provinceCode}:${postalCode}`
}

const readCachedRate = (cacheKey: string): number | null => {
  const cached = rateCache.get(cacheKey)
  if (!cached) {
    return null
  }

  if (cached.expiresAt <= Date.now()) {
    rateCache.delete(cacheKey)
    return null
  }

  return cached.ratePercent
}

const writeCachedRate = (cacheKey: string, ratePercent: number) => {
  rateCache.set(cacheKey, {
    ratePercent,
    expiresAt: Date.now() + CACHE_TTL_MS,
  })
}

export default class TaxRateLookupProviderService implements ITaxProvider {
  static identifier = 'rate_lookup'
  protected logger_: Logger
  protected options_: TaxRateLookupProviderOptions

  constructor({ logger }: InjectedDependencies, options: TaxRateLookupProviderOptions) {
    this.logger_ = logger
    this.options_ = options
  }

  getIdentifier(): string {
    return TaxRateLookupProviderService.identifier
  }

  async getTaxLines(
    itemLines: ItemTaxCalculationLine[],
    shippingLines: ShippingTaxCalculationLine[],
    context: TaxCalculationContext
  ): Promise<(ItemTaxLineDTO | ShippingTaxLineDTO)[]> {
    const ratePercent = await this.resolveRatePercent(context)

    if (ratePercent <= 0) {
      return []
    }

    const providerId = this.getIdentifier()
    const name = 'Sales tax'
    const code = 'sales_tax'

    const itemTaxLines: ItemTaxLineDTO[] = itemLines.map((line) => ({
      line_item_id: line.line_item.id,
      rate: ratePercent,
      name,
      code,
      provider_id: providerId,
    }))

    const shippingTaxLines: ShippingTaxLineDTO[] = shippingLines.map((line) => ({
      shipping_line_id: line.shipping_line.id,
      rate: ratePercent,
      name,
      code,
      provider_id: providerId,
    }))

    return [...itemTaxLines, ...shippingTaxLines]
  }

  private async resolveRatePercent(context: TaxCalculationContext): Promise<number> {
    const cacheKey = buildCacheKey(context.address)
    if (!cacheKey) {
      throw new Error('Tax calculation requires a country and postal code.')
    }

    const cached = readCachedRate(cacheKey)
    if (cached !== null) {
      return cached
    }

    const countryCode = context.address.country_code?.toLowerCase()
    if (countryCode !== 'us') {
      this.logger_.warn(`Tax lookup skipped for unsupported country: ${countryCode}`)
      return 0
    }

    const postalCode = context.address.postal_code?.trim()
    if (!postalCode) {
      throw new Error('Tax calculation requires a postal code.')
    }

    if (this.options_.provider !== 'taxrate_io') {
      throw new Error(`Unsupported tax provider: ${this.options_.provider}`)
    }

    if (!this.options_.apiKey) {
      throw new Error('TAX_RATE_LOOKUP_API_KEY is not set.')
    }

    if (this.options_.mode && this.options_.mode !== 'zip') {
      this.logger_.warn(`Tax lookup mode "${this.options_.mode}" is not supported. Using zip lookup.`)
    }

    const ratePercent = await fetchTaxRateIo({
      apiKey: this.options_.apiKey,
      zip: postalCode,
      timeoutMs: this.options_.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    })

    writeCachedRate(cacheKey, ratePercent)
    return ratePercent
  }
}
