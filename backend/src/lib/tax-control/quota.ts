import type { Logger } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import type { RedisClientType } from "redis"
import { createClient } from "redis"

import { REDIS_URL } from "../constants"
import { buildBackendRuntimeEvent } from "../observability/runtime-event"
import {
  TAXRATE_IO_QUOTA_ID,
  TAXRATE_IO_QUOTA_REDIS_KEY,
} from "../../modules/tax-control/constants"
import type TaxControlModuleService from "../../modules/tax-control/service"
import {
  taxProviderQuotaListFrom,
  taxProviderQuotaMatches,
  taxProviderQuotaMutationFrom,
  type TaxProviderQuotaRecord,
} from "../../modules/tax-control/persistence-contracts"
import type { TaxRateIoQuota } from "../../modules/tax-rate-provider/clients/taxrate-io"
import {
  parsePersistedTaxRateIoQuota,
  parseTaxRateIoQuotaSnapshot,
  type PersistedTaxRateIoQuota,
} from "../../modules/tax-rate-provider/cache-contracts"

let quotaRedisClient: RedisClientType | null = null
let quotaRedisConnectPromise: Promise<RedisClientType | null> | null = null

const warn = (logger: Logger, event: string, message: string): void => {
  logger.warn(JSON.stringify(buildBackendRuntimeEvent(event, message)))
}

const parseQuota = (value: string | null): TaxRateIoQuota | null => {
  if (!value) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(value)
    return parseTaxRateIoQuotaSnapshot(parsed)
  } catch {
    return null
  }
}

const validQuota = (quota: TaxRateIoQuota): TaxRateIoQuota => {
  const parsed = parseTaxRateIoQuotaSnapshot(quota)
  if (!parsed) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "TaxRate.io returned an invalid quota snapshot."
    )
  }
  return parsed
}

const validPersistedQuota = (value: unknown): PersistedTaxRateIoQuota => {
  const parsed = parsePersistedTaxRateIoQuota(value)
  if (!parsed) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The persisted TaxRate.io quota snapshot is invalid."
    )
  }
  return parsed
}

const exactQuota = (
  actual: TaxProviderQuotaRecord,
  expected: TaxProviderQuotaRecord,
  message: string
): TaxProviderQuotaRecord => {
  if (!taxProviderQuotaMatches(actual, expected)) {
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, message)
  }
  return actual
}

const redisClient = async (logger: Logger): Promise<RedisClientType | null> => {
  const redisUrl = REDIS_URL?.trim()
  if (!redisUrl) {
    return null
  }
  if (quotaRedisClient?.isOpen) {
    return quotaRedisClient
  }
  if (quotaRedisConnectPromise) {
    return quotaRedisConnectPromise
  }

  const client =
    quotaRedisClient ??
    createClient({
      url: redisUrl,
      RESP: 3,
      socket: {
        connectTimeout: 2_000,
        reconnectStrategy: (retries) =>
          retries >= 3 ? false : Math.min(100 * 2 ** retries, 1_000),
      },
    }).on("error", () => {
      warn(logger, "tax.quota.redis_error", "Tax quota Redis connection error")
    })
  quotaRedisClient = client
  quotaRedisConnectPromise = client
    .connect()
    .then(() => client)
    .catch(() => {
      warn(
        logger,
        "tax.quota.redis_connection_failed",
        "Tax quota Redis connection failed"
      )
      try {
        client.destroy()
      } catch {
        // The persisted snapshot remains available if Redis is down.
      }
      quotaRedisClient = null
      return null
    })
    .finally(() => {
      quotaRedisConnectPromise = null
    })
  return quotaRedisConnectPromise
}

export const writeTaxRateIoQuotaToRedis = async (
  logger: Logger,
  quota: TaxRateIoQuota
): Promise<void> => {
  const parsed = validQuota(quota)
  const client = await redisClient(logger)
  if (client) {
    await client.set(TAXRATE_IO_QUOTA_REDIS_KEY, JSON.stringify(parsed))
  }
}

export const persistTaxRateIoQuota = async ({
  quota,
  service,
  source,
}: {
  quota: TaxRateIoQuota
  service: TaxControlModuleService
  source: "checkout_lookup" | "manual_refresh"
}) => {
  const validatedQuota = validQuota(quota)
  const existing = taxProviderQuotaListFrom(
    await service.listTaxProviderQuotas(
      { provider: "taxrate_io" },
      { take: 2 }
    ),
    1
  )
  const observedAt = new Date(validatedQuota.observedAt)
  const payload = {
    id: TAXRATE_IO_QUOTA_ID,
    metadata: {},
    observed_at: observedAt,
    provider: "taxrate_io",
    quota: validatedQuota.quota,
    remaining: validatedQuota.remaining,
    source,
    usage: validatedQuota.usage,
    usage_percent: validatedQuota.usagePercent,
  }
  const updateExisting = async (current: TaxProviderQuotaRecord) => {
    if (current.observed_at > observedAt) {
      return current
    }
    const expected: TaxProviderQuotaRecord = {
      ...current,
      ...payload,
      id: current.id,
      provider: "taxrate_io",
    }
    const updated = taxProviderQuotaMutationFrom(
      await service.updateTaxProviderQuotas([{ ...payload, id: current.id }])
    )
    return exactQuota(
      updated,
      expected,
      "The persisted TaxRate.io quota update does not match the snapshot."
    )
  }
  const current = existing[0]
  if (current) {
    return updateExisting(current)
  }

  try {
    const created = taxProviderQuotaMutationFrom(
      await service.createTaxProviderQuotas([payload])
    )
    return exactQuota(
      created,
      { ...payload, id: created.id, provider: "taxrate_io" },
      "The persisted TaxRate.io quota creation does not match the snapshot."
    )
  } catch (error) {
    if (
      !MedusaError.isMedusaError(error) ||
      error.type !== MedusaError.Types.DUPLICATE_ERROR
    ) {
      throw error
    }
    const concurrent = taxProviderQuotaListFrom(
      await service.listTaxProviderQuotas(
        { provider: "taxrate_io" },
        { take: 2 }
      ),
      1
    )
    const winner = concurrent[0]
    if (!winner) {
      throw error
    }
    return updateExisting(winner)
  }
}

export const syncTaxRateIoQuota = async ({
  logger,
  service,
}: {
  logger: Logger
  service: TaxControlModuleService
}) => {
  const client = await redisClient(logger)
  if (client) {
    try {
      const quota = parseQuota(await client.get(TAXRATE_IO_QUOTA_REDIS_KEY))
      if (quota) {
        const persisted = await persistTaxRateIoQuota({
          quota,
          service,
          source: "checkout_lookup",
        })
        return persisted ? validPersistedQuota(persisted) : null
      }
    } catch {
      warn(
        logger,
        "tax.quota.synchronization_failed",
        "Tax quota synchronization failed"
      )
    }
  }

  const persisted = taxProviderQuotaListFrom(
    await service.listTaxProviderQuotas(
      { provider: "taxrate_io" },
      { order: { observed_at: "DESC" }, take: 2 }
    ),
    1
  )
  return persisted[0] ? validPersistedQuota(persisted[0]) : null
}
