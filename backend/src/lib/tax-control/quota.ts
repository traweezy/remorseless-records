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
import type { TaxRateIoQuota } from "../../modules/tax-rate-provider/clients/taxrate-io"

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
    const parsed = JSON.parse(value) as TaxRateIoQuota
    const observed = Date.parse(parsed.observedAt)
    if (
      !Number.isFinite(observed) ||
      !Number.isSafeInteger(parsed.usage) ||
      !Number.isSafeInteger(parsed.quota) ||
      !Number.isSafeInteger(parsed.remaining) ||
      !Number.isFinite(parsed.usagePercent) ||
      parsed.usage < 0 ||
      parsed.quota <= 0 ||
      parsed.remaining < 0
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
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
  const client = await redisClient(logger)
  if (client) {
    await client.set(TAXRATE_IO_QUOTA_REDIS_KEY, JSON.stringify(quota))
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
  const existing = await service.listTaxProviderQuotas(
    { provider: "taxrate_io" },
    { take: 1 }
  )
  const observedAt = new Date(quota.observedAt)
  const payload = {
    id: TAXRATE_IO_QUOTA_ID,
    metadata: {},
    observed_at: observedAt,
    provider: "taxrate_io",
    quota: quota.quota,
    remaining: quota.remaining,
    source,
    usage: quota.usage,
    usage_percent: quota.usagePercent,
  }
  const updateExisting = async (current: (typeof existing)[number]) => {
    const currentObservedAt = new Date(current.observed_at)
    if (
      Number.isFinite(currentObservedAt.getTime()) &&
      currentObservedAt > observedAt
    ) {
      return current
    }
    const [updated] = await service.updateTaxProviderQuotas([
      { ...payload, id: current.id },
    ])
    return updated ?? current
  }
  const current = existing[0]
  if (current) {
    return updateExisting(current)
  }

  try {
    const [created] = await service.createTaxProviderQuotas([payload])
    return created ?? null
  } catch (error) {
    if (
      !MedusaError.isMedusaError(error) ||
      error.type !== MedusaError.Types.DUPLICATE_ERROR
    ) {
      throw error
    }
    const concurrent = await service.listTaxProviderQuotas(
      { provider: "taxrate_io" },
      { take: 1 }
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
        return persistTaxRateIoQuota({
          quota,
          service,
          source: "checkout_lookup",
        })
      }
    } catch {
      warn(
        logger,
        "tax.quota.synchronization_failed",
        "Tax quota synchronization failed"
      )
    }
  }

  const persisted = await service.listTaxProviderQuotas(
    { provider: "taxrate_io" },
    { order: { observed_at: "DESC" }, take: 1 }
  )
  return persisted[0] ?? null
}
