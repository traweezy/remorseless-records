import type {
  ILockingModule,
  Logger,
  MedusaContainer,
} from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"

import { CHECKOUT_RECONCILIATION_JOB_LOCK } from "../lib/checkout/reconciliation"
import reconcileCheckoutPaymentsJob from "./reconcile-checkout-payments"

const managedEnvironmentKeys = [
  "CHECKOUT_RECONCILIATION_ENABLED",
  "CHECKOUT_RECONCILIATION_MAX_ATTEMPTS",
  "CHECKOUT_RECONCILIATION_MAX_RUN_SECONDS",
  "CHECKOUT_RECONCILIATION_MAX_SCAN",
  "CHECKOUT_RECONCILIATION_MIN_AGE_SECONDS",
] as const

const originalEnvironment = Object.fromEntries(
  managedEnvironmentKeys.map((key) => [key, process.env[key]])
) as Record<(typeof managedEnvironmentKeys)[number], string | undefined>

const parseEvent = (write: jest.Mock): Record<string, unknown> =>
  JSON.parse(write.mock.calls[0]?.[0] ?? "{}") as Record<string, unknown>

const fixtures = () => {
  const logger = {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  }
  const lockingService = {
    acquire: jest.fn(
      async (
        _keys: string | string[],
        _args?: { expire?: number; ownerId?: string | null }
      ): Promise<void> => undefined
    ),
    release: jest.fn(
      async (
        _keys: string | string[],
        _args?: { ownerId?: string | null }
      ): Promise<boolean> => true
    ),
  }
  const query = {
    graph: jest.fn(async () => ({ data: [] })),
  }
  const cartService = {
    updateCarts: jest.fn(async () => undefined),
  }
  const container = {
    resolve: jest.fn((key: string) => {
      if (key === "logger") {
        return logger as unknown as Logger
      }
      if (key === Modules.LOCKING) {
        return lockingService as unknown as ILockingModule
      }
      if (key === Modules.CART) {
        return cartService
      }
      if (key === ContainerRegistrationKeys.QUERY) {
        return query
      }
      throw new Error(`Unexpected container key: ${key}`)
    }),
  } as unknown as MedusaContainer

  return { cartService, container, lockingService, logger, query }
}

describe("checkout reconciliation scheduled job", () => {
  beforeEach(() => {
    for (const key of managedEnvironmentKeys) {
      delete process.env[key]
    }
    process.env.CHECKOUT_RECONCILIATION_ENABLED = "true"
  })

  afterAll(() => {
    for (const key of managedEnvironmentKeys) {
      const value = originalEnvironment[key]
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })

  it("uses an owned lock and emits a bounded structured completion", async () => {
    const fixture = fixtures()
    const digest = "a".repeat(64)

    await reconcileCheckoutPaymentsJob(fixture.container, {
      scheduledFor: new Date(),
      bullJobIdSha256: digest,
    })

    expect(fixture.lockingService.acquire).toHaveBeenCalledWith(
      CHECKOUT_RECONCILIATION_JOB_LOCK,
      {
        expire: 300,
        ownerId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      }
    )
    const ownerId = fixture.lockingService.acquire.mock.calls[0]?.[1]?.ownerId
    expect(fixture.lockingService.release).toHaveBeenCalledWith(
      CHECKOUT_RECONCILIATION_JOB_LOCK,
      { ownerId }
    )
    expect(fixture.query.graph).toHaveBeenCalledWith(
      expect.objectContaining({
        pagination: {
          order: { updated_at: "DESC", id: "DESC" },
          take: 2_000,
        },
      })
    )
    expect(fixture.logger.info).toHaveBeenCalledTimes(1)
    expect(parseEvent(fixture.logger.info)).toMatchObject({
      event: "job.checkout_reconciliation.completed",
      lock_released: true,
      message: "Checkout reconciliation completed",
      scanWindowFull: false,
      scanned: 0,
      service: "backend",
      timeCapped: false,
      heldForReview: 0,
      bull_job_id_sha256: digest,
      bull_job_identity_verified: true,
      counts_available: true,
      carts_examined: 0,
      carts_completed: 0,
    })
    expect(parseEvent(fixture.logger.info).run_id).toEqual(
      expect.stringMatching(/^[0-9a-f-]{36}$/u)
    )
    expect(parseEvent(fixture.logger.info).finished_at).toEqual(
      expect.any(String)
    )
  })

  it("warns when scheduler delay crosses the former lock window", async () => {
    const fixture = fixtures()

    await reconcileCheckoutPaymentsJob(fixture.container, {
      scheduledFor: new Date(Date.now() - 35_000),
    })

    const event = parseEvent(fixture.logger.warn)
    expect(event).toMatchObject({
      event: "job.checkout_reconciliation.attention",
      message: "Checkout reconciliation needs attention",
    })
    expect(event.schedule_delay_ms).toEqual(expect.any(Number))
    expect(event.schedule_delay_ms as number).toBeGreaterThanOrEqual(35_000)
  })

  it("skips an overlapping retry without releasing another owner's lock", async () => {
    const fixture = fixtures()
    fixture.lockingService.acquire.mockRejectedValue(
      new MedusaError(MedusaError.Types.CONFLICT, "private lock detail")
    )

    await reconcileCheckoutPaymentsJob(fixture.container, {
      scheduledFor: new Date(),
    })

    expect(fixture.query.graph).not.toHaveBeenCalled()
    expect(fixture.lockingService.release).not.toHaveBeenCalled()
    expect(parseEvent(fixture.logger.warn)).toMatchObject({
      event: "job.checkout_reconciliation.skipped",
      message: "Checkout reconciliation skipped because a run holds the lock",
      reason: "lock_held",
    })
    expect(fixture.logger.warn.mock.calls[0]?.[0]).not.toContain(
      "private lock detail"
    )
  })

  it("redacts reconciliation failures and releases the owned lock", async () => {
    const fixture = fixtures()
    fixture.query.graph.mockRejectedValue(
      new Error("provider failure for private@example.com")
    )

    await expect(
      reconcileCheckoutPaymentsJob(fixture.container, {
        scheduledFor: new Date(),
      })
    ).rejects.toThrow("provider failure")

    expect(fixture.lockingService.release).toHaveBeenCalledTimes(1)
    expect(parseEvent(fixture.logger.error)).toMatchObject({
      event: "job.checkout_reconciliation.failed",
      failure_stage: "reconciliation",
      lock_released: true,
      message: "Checkout reconciliation failed",
      counts_available: false,
      carts_examined: null,
      carts_completed: null,
      bull_job_identity_verified: false,
    })
    expect(fixture.logger.error.mock.calls[0]?.[0]).not.toContain(
      "private@example.com"
    )
  })

  it("reports unavailable counts when lock acquisition fails", async () => {
    const fixture = fixtures()
    fixture.lockingService.acquire.mockRejectedValue(
      new Error("private lock detail")
    )

    await expect(
      reconcileCheckoutPaymentsJob(fixture.container)
    ).rejects.toThrow("private lock detail")
    expect(fixture.query.graph).not.toHaveBeenCalled()
    expect(parseEvent(fixture.logger.error)).toMatchObject({
      event: "job.checkout_reconciliation.failed",
      failure_stage: "lock_acquisition",
      counts_available: false,
      carts_examined: null,
      carts_completed: null,
    })
    expect(fixture.logger.error.mock.calls[0]?.[0]).not.toContain(
      "private lock detail"
    )
  })

  it("does not log an untrusted identity when reconciliation is disabled", async () => {
    process.env.CHECKOUT_RECONCILIATION_ENABLED = "false"
    const fixture = fixtures()
    await reconcileCheckoutPaymentsJob(fixture.container, {
      bullJobIdSha256: "private@example.com",
    })
    expect(fixture.query.graph).not.toHaveBeenCalled()
    expect(parseEvent(fixture.logger.info)).toMatchObject({
      event: "job.checkout_reconciliation.disabled",
      bull_job_id_sha256: null,
      bull_job_identity_verified: false,
      counts_available: true,
      carts_examined: 0,
      carts_completed: 0,
    })
    expect(fixture.logger.info.mock.calls[0]?.[0]).not.toContain(
      "private@example.com"
    )
  })

  it("does not turn a disabled job into a failure if logging fails", async () => {
    process.env.CHECKOUT_RECONCILIATION_ENABLED = "false"
    const fixture = fixtures()
    fixture.logger.info.mockImplementation(() => {
      throw new Error("log transport failed")
    })
    await expect(
      reconcileCheckoutPaymentsJob(fixture.container)
    ).resolves.toBeUndefined()
    expect(fixture.query.graph).not.toHaveBeenCalled()
  })
})
