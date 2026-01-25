import type {
  ITaxProvider,
  ItemTaxCalculationLine,
  ItemTaxLineDTO,
  Logger,
  ShippingTaxCalculationLine,
  ShippingTaxLineDTO,
  TaxCalculationContext,
} from '@medusajs/framework/types'
import type { RedisClientType } from 'redis'
import { createClient } from 'redis'

import { fetchTaxRateIo } from './clients/taxrate-io'
import { REDIS_URL } from '../../lib/constants'

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

const CACHE_TTL_MS = Number(process.env.TAX_RATE_LOOKUP_CACHE_TTL_MS ?? 5 * 60 * 1000)
const DEFAULT_TIMEOUT_MS = 8_000
const rateCache = new Map<string, CachedRate>()
const redisUrl = REDIS_URL?.trim()
let redisClient: RedisClientType | null = null
let redisConnectPromise: Promise<RedisClientType | null> | null = null

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

const getRedisClient = async (logger: Logger): Promise<RedisClientType | null> => {
  if (!redisUrl) {
    return null
  }

  if (redisClient?.isOpen) {
    return redisClient
  }

  if (redisConnectPromise) {
    return redisConnectPromise
  }

  const client = redisClient ?? createClient({ url: redisUrl })
  redisClient = client

  redisConnectPromise = client
    .connect()
    .then(() => client)
    .catch((error) => {
      logger.warn(`Tax cache Redis connection failed: ${(error as Error).message ?? error}`)
      try {
        void client.disconnect()
      } catch {
        // ignore disconnect errors
      }
      redisClient = null
      return null
    })
    .finally(() => {
      redisConnectPromise = null
    })

  return redisConnectPromise
}

const buildRedisKey = (cacheKey: string) => `taxrate:${cacheKey}`

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
      return 0
    }

    const cached = readCachedRate(cacheKey)
    if (cached !== null) {
      return cached
    }

    const redisClientInstance = await getRedisClient(this.logger_)
    if (redisClientInstance) {
      try {
        const redisValue = await redisClientInstance.get(buildRedisKey(cacheKey))
        if (redisValue !== null) {
          const parsed = Number(redisValue)
          if (Number.isFinite(parsed)) {
            writeCachedRate(cacheKey, parsed)
            return parsed
          }
        }
      } catch (error) {
        this.logger_.warn(
          `Tax cache Redis lookup failed: ${(error as Error).message ?? error}`
        )
      }
    }

    const countryCode = context.address.country_code?.toLowerCase()
    if (!countryCode) {
      return 0
    }

    if (countryCode !== 'us') {
      this.logger_.warn(`Tax lookup skipped for unsupported country: ${countryCode}`)
      return 0
    }

    const postalCode = context.address.postal_code?.trim()
    if (!postalCode) {
      return 0
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
    if (redisClientInstance) {
      try {
        const ttlSeconds = Math.max(1, Math.ceil(CACHE_TTL_MS / 1000))
        await redisClientInstance.set(buildRedisKey(cacheKey), String(ratePercent), {
          EX: ttlSeconds,
        })
      } catch (error) {
        this.logger_.warn(
          `Tax cache Redis write failed: ${(error as Error).message ?? error}`
        )
      }
    }
    return ratePercent
  }
}
