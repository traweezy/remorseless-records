import { MedusaError } from "@medusajs/framework/utils"

jest.mock("../constants", () => ({
  REDIS_URL: "",
}))

import {
  persistTaxRateIoQuota,
  syncTaxRateIoQuota,
  type TaxRateIoQuotaSyncObservation,
} from "./quota"
import type TaxControlModuleService from "../../modules/tax-control/service"

const quota = (observedAt: string) => ({
  observedAt,
  quota: 100,
  remaining: 75,
  usage: 25,
  usagePercent: 25,
})

const record = (
  observedAt: string,
  overrides: Record<string, unknown> = {}
) => ({
  id: "taxquota_01",
  metadata: {},
  observed_at: new Date(observedAt),
  provider: "taxrate_io",
  quota: 100,
  remaining: 75,
  source: "checkout_lookup",
  usage: 25,
  usage_percent: 25,
  ...overrides,
})

describe("TaxRate.io quota persistence", () => {
  it("rejects an incoherent quota before persistence", async () => {
    const service = {
      listTaxProviderQuotas: jest.fn(),
    } as unknown as TaxControlModuleService

    await expect(
      persistTaxRateIoQuota({
        quota: { ...quota("2026-07-26T12:00:00.000Z"), remaining: 74 },
        service,
        source: "checkout_lookup",
      })
    ).rejects.toMatchObject({
      message: "TaxRate.io returned an invalid quota snapshot.",
    })
    expect(service.listTaxProviderQuotas).not.toHaveBeenCalled()
  })

  it("does not overwrite a newer authoritative snapshot", async () => {
    const current = record("2026-07-26T12:05:00.000Z")
    const service = {
      listTaxProviderQuotas: jest.fn(async () => [current]),
      updateTaxProviderQuotas: jest.fn(),
    } as unknown as TaxControlModuleService

    await expect(
      persistTaxRateIoQuota({
        quota: quota("2026-07-26T12:00:00.000Z"),
        service,
        source: "checkout_lookup",
      })
    ).resolves.toEqual(current)
    expect(service.updateTaxProviderQuotas).not.toHaveBeenCalled()
  })

  it("updates an older persisted snapshot", async () => {
    const observation: TaxRateIoQuotaSyncObservation = {
      redisSnapshotsValidated: 0,
      quotaRowsReturned: 0,
      quotaWritesConfirmed: 0,
    }
    const updated = record("2026-07-26T12:05:00.000Z")
    const service = {
      listTaxProviderQuotas: jest.fn(async () => [
        record("2026-07-26T12:00:00.000Z"),
      ]),
      updateTaxProviderQuotas: jest.fn(async () => [updated]),
    } as unknown as TaxControlModuleService

    await expect(
      persistTaxRateIoQuota({
        quota: quota("2026-07-26T12:05:00.000Z"),
        service,
        source: "checkout_lookup",
        observation,
      })
    ).resolves.toEqual(updated)
    expect(observation).toEqual({
      redisSnapshotsValidated: 0,
      quotaRowsReturned: 1,
      quotaWritesConfirmed: 1,
    })
  })

  it("counts a confirmed equal-snapshot write without claiming a value change", async () => {
    const same = record("2026-07-26T12:00:00.000Z")
    const observation: TaxRateIoQuotaSyncObservation = {
      redisSnapshotsValidated: 0,
      quotaRowsReturned: 0,
      quotaWritesConfirmed: 0,
    }
    const service = {
      listTaxProviderQuotas: jest.fn(async () => [same]),
      updateTaxProviderQuotas: jest.fn(async () => [same]),
    } as unknown as TaxControlModuleService
    await persistTaxRateIoQuota({
      quota: quota("2026-07-26T12:00:00.000Z"),
      service,
      source: "checkout_lookup",
      observation,
    })
    expect(observation.quotaWritesConfirmed).toBe(1)
    expect(observation.quotaRowsReturned).toBe(1)
  })

  it("re-reads and updates the winner of a first-write race", async () => {
    const winner = record("2026-07-26T12:00:00.000Z")
    const updated = record("2026-07-26T12:05:00.000Z", {
      source: "manual_refresh",
    })
    const service = {
      createTaxProviderQuotas: jest.fn(async () => {
        throw new MedusaError(MedusaError.Types.DUPLICATE_ERROR, "duplicate")
      }),
      listTaxProviderQuotas: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([winner]),
      updateTaxProviderQuotas: jest.fn(async () => [updated]),
    } as unknown as TaxControlModuleService

    await expect(
      persistTaxRateIoQuota({
        quota: quota("2026-07-26T12:05:00.000Z"),
        service,
        source: "manual_refresh",
      })
    ).resolves.toEqual(updated)
    expect(service.updateTaxProviderQuotas).toHaveBeenCalledTimes(1)
  })

  it("normalizes a complete persisted snapshot during synchronization", async () => {
    const observation: TaxRateIoQuotaSyncObservation = {
      redisSnapshotsValidated: 0,
      quotaRowsReturned: 0,
      quotaWritesConfirmed: 0,
    }
    const service = {
      listTaxProviderQuotas: jest.fn(async () => [
        {
          ...record("2026-07-26T12:00:00.000Z", {
            source: "manual_refresh",
          }),
        },
      ]),
    } as unknown as TaxControlModuleService

    await expect(
      syncTaxRateIoQuota({
        logger: { warn: jest.fn() } as never,
        service,
        observation,
      })
    ).resolves.toEqual({
      observedAt: "2026-07-26T12:00:00.000Z",
      quota: 100,
      remaining: 75,
      source: "manual_refresh",
      usage: 25,
      usagePercent: 25,
    })
    expect(observation).toEqual({
      redisSnapshotsValidated: 0,
      quotaRowsReturned: 1,
      quotaWritesConfirmed: 0,
    })
  })

  it("fails the scheduled sync when a valid Redis snapshot cannot be persisted", async () => {
    const observation: TaxRateIoQuotaSyncObservation = {
      redisSnapshotsValidated: 0,
      quotaRowsReturned: 0,
      quotaWritesConfirmed: 0,
    }
    const failure = new Error("private persistence failure")
    const service = {
      listTaxProviderQuotas: jest.fn(async () => [
        record("2026-07-26T12:00:00.000Z"),
      ]),
      updateTaxProviderQuotas: jest.fn(async () => {
        throw failure
      }),
    } as unknown as TaxControlModuleService

    await expect(
      syncTaxRateIoQuota({
        logger: { warn: jest.fn() } as never,
        service,
        observation,
        redisReader: async () =>
          JSON.stringify(quota("2026-07-26T12:05:00.000Z")),
      })
    ).rejects.toBe(failure)
    expect(service.listTaxProviderQuotas).toHaveBeenCalledTimes(1)
    expect(observation).toEqual({
      redisSnapshotsValidated: 1,
      quotaRowsReturned: 1,
      quotaWritesConfirmed: 0,
    })
  })

  it("fails closed on a malformed persisted snapshot", async () => {
    const service = {
      listTaxProviderQuotas: jest.fn(async () => [
        {
          observed_at: new Date("2026-07-26T12:00:00.000Z"),
          provider: "taxrate_io",
          quota: 100,
          remaining: 74,
          source: "checkout_lookup",
          usage: 25,
          usage_percent: 25,
        },
      ]),
    } as unknown as TaxControlModuleService

    await expect(
      syncTaxRateIoQuota({
        logger: { warn: jest.fn() } as never,
        service,
      })
    ).rejects.toThrow("persisted TaxRate.io quota snapshot is invalid")
  })
})
