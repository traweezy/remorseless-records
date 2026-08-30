import { MedusaError } from "@medusajs/framework/utils"

jest.mock("../constants", () => ({
  REDIS_URL: "",
}))

import { persistTaxRateIoQuota } from "./quota"
import type TaxControlModuleService from "../../modules/tax-control/service"

const quota = (observedAt: string) => ({
  observedAt,
  quota: 100,
  remaining: 75,
  usage: 25,
  usagePercent: 25,
})

const record = (observedAt: string) => ({
  id: "taxquota_01",
  observed_at: new Date(observedAt),
  provider: "taxrate_io",
})

describe("TaxRate.io quota persistence", () => {
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
    ).resolves.toBe(current)
    expect(service.updateTaxProviderQuotas).not.toHaveBeenCalled()
  })

  it("updates an older persisted snapshot", async () => {
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
      })
    ).resolves.toBe(updated)
  })

  it("re-reads and updates the winner of a first-write race", async () => {
    const winner = record("2026-07-26T12:00:00.000Z")
    const updated = record("2026-07-26T12:05:00.000Z")
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
    ).resolves.toBe(updated)
    expect(service.updateTaxProviderQuotas).toHaveBeenCalledTimes(1)
  })
})
