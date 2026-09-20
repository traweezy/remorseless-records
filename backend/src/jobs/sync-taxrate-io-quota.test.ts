import type { Logger, MedusaContainer } from "@medusajs/framework/types"

import { syncTaxRateIoQuota } from "../lib/tax-control/quota"
import syncTaxRateIoQuotaJob from "./sync-taxrate-io-quota"

jest.mock("../lib/tax-control/quota", () => ({
  syncTaxRateIoQuota: jest.fn(),
}))

const mockedSync = jest.mocked(syncTaxRateIoQuota)

const fixture = () => {
  const logger = { info: jest.fn(), error: jest.fn() }
  const service = {}
  const container = {
    resolve: jest.fn((key: string) => {
      if (key === "logger") return logger as unknown as Logger
      if (key === "tax_control") return service
      throw new Error("Unexpected container registration")
    }),
  } as unknown as MedusaContainer
  return { container, logger, service }
}

describe("TaxRate.io quota scheduled job observations", () => {
  beforeEach(() => mockedSync.mockReset())

  it("logs an execution window and confirmed non-payment counts", async () => {
    const { container, logger } = fixture()
    mockedSync.mockImplementation(async ({ observation }) => {
      if (observation) {
        observation.redisSnapshotsValidated = 1
        observation.quotaRowsReturned = 2
        observation.quotaWritesConfirmed = 1
      }
      return null
    })
    const digest = "b".repeat(64)
    await syncTaxRateIoQuotaJob(container, {
      bullJobIdSha256: digest,
      scheduledFor: new Date("2026-01-01T00:00:00.000Z"),
    })
    const event = JSON.parse(logger.info.mock.calls[0]?.[0] ?? "{}")
    expect(event).toMatchObject({
      event: "job.taxrate_quota_sync.completed",
      bull_job_id_sha256: digest,
      bull_job_identity_verified: true,
      scheduled_for: "2026-01-01T00:00:00.000Z",
      failure_stage: null,
      counts_available: true,
      redis_snapshots_validated: 1,
      quota_rows_returned: 2,
      quota_writes_confirmed: 1,
    })
    expect(event.run_id).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/u))
    expect(new Date(event.finished_at).getTime()).toBeGreaterThanOrEqual(
      new Date(event.started_at).getTime()
    )
  })

  it("preserves the original failure and suppresses raw identity", async () => {
    const { container, logger } = fixture()
    const original = new Error("private@example.com")
    mockedSync.mockRejectedValue(original)
    await expect(
      syncTaxRateIoQuotaJob(container, {
        bullJobIdSha256: "private@example.com",
      })
    ).rejects.toBe(original)
    const raw = logger.error.mock.calls[0]?.[0] ?? ""
    const event = JSON.parse(raw)
    expect(event).toMatchObject({
      event: "job.taxrate_quota_sync.failed",
      bull_job_id_sha256: null,
      bull_job_identity_verified: false,
      failure_stage: "synchronization",
      counts_available: false,
      redis_snapshots_validated: null,
      quota_rows_returned: null,
      quota_writes_confirmed: null,
    })
    expect(raw).not.toContain("private@example.com")
  })

  it("does not let a logging failure change job success", async () => {
    const { container, logger } = fixture()
    mockedSync.mockResolvedValue(null)
    logger.info.mockImplementation(() => {
      throw new Error("log transport failed")
    })
    await expect(syncTaxRateIoQuotaJob(container)).resolves.toBeUndefined()
  })
})
