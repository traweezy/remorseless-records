import { deletePaymentSessionsWorkflow } from "@medusajs/core-flows"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import {
  removeAbandonedGuestCheckouts,
  resolveAbandonedCheckoutRetentionConfig,
} from "../lib/abandoned-checkout-retention"
import { writeRetentionJobEvent } from "../lib/observability/retention-job"
import removeAbandonedGuestCheckoutsJob, {
  config,
} from "./remove-abandoned-guest-checkouts"

jest.mock("@medusajs/core-flows", () => ({
  deletePaymentSessionsWorkflow: jest.fn(),
}))
jest.mock("../lib/abandoned-checkout-retention", () => ({
  ABANDONED_CHECKOUT_RETENTION_JOB_LOCK: "jobs:abandoned-checkout-retention",
  removeAbandonedGuestCheckouts: jest.fn(),
  resolveAbandonedCheckoutRetentionConfig: jest.fn(),
}))
jest.mock("../lib/observability/retention-job", () => ({
  writeRetentionJobEvent: jest.fn(async () => undefined),
}))

const deleteWorkflowMock = deletePaymentSessionsWorkflow as jest.MockedFunction<
  typeof deletePaymentSessionsWorkflow
>
const removeMock = removeAbandonedGuestCheckouts as jest.MockedFunction<
  typeof removeAbandonedGuestCheckouts
>
const resolveConfigMock =
  resolveAbandonedCheckoutRetentionConfig as jest.MockedFunction<
    typeof resolveAbandonedCheckoutRetentionConfig
  >
const writeEventMock = writeRetentionJobEvent as jest.MockedFunction<
  typeof writeRetentionJobEvent
>

const fixture = () => {
  const logger = {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  }
  const cartService = {}
  const lockingService = {
    execute: jest.fn(async (_key: string, operation: () => Promise<unknown>) =>
      operation()
    ),
  }
  const query = { graph: jest.fn() }
  const resolve = jest.fn((key: string) => {
    if (key === "logger") {
      return logger
    }
    if (key === Modules.CART) {
      return cartService
    }
    if (key === Modules.LOCKING) {
      return lockingService
    }
    if (key === ContainerRegistrationKeys.QUERY) {
      return query
    }
    throw new Error(`Unexpected container key: ${key}`)
  })

  return {
    cartService,
    container: { resolve } as never,
    lockingService,
    logger,
    query,
    resolve,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  resolveConfigMock.mockReturnValue({
    enabled: true,
    maxDeletionsPerRun: 250,
    retentionDays: 37,
  })
  removeMock.mockResolvedValue({
    capped: false,
    cutoff: "2026-07-24T04:37:00.000Z",
    deleted: 1,
    paymentCollectionsCanceled: 1,
    protectedByOrder: 2,
    protectedByPayment: 3,
    scanned: 7,
  })
  deleteWorkflowMock.mockReturnValue({
    run: jest.fn(async () => undefined),
  } as never)
})

describe("abandoned checkout retention job", () => {
  it("retains the reviewed daily schedule", () => {
    expect(config).toEqual({
      name: "remove-abandoned-guest-checkouts",
      schedule: "37 4 * * *",
    })
  })

  it("records a disabled heartbeat without resolving mutation services", async () => {
    const input = fixture()
    resolveConfigMock.mockReturnValue({
      enabled: false,
      maxDeletionsPerRun: 250,
      retentionDays: 37,
    })

    await expect(
      removeAbandonedGuestCheckoutsJob(input.container)
    ).resolves.toBeUndefined()

    expect(input.resolve).toHaveBeenCalledTimes(1)
    expect(removeMock).not.toHaveBeenCalled()
    expect(writeEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          deleted: 0,
          job: "abandoned_checkout",
          scanned: 0,
          status: "disabled",
        }),
        level: "info",
        logger: input.logger,
      })
    )
  })

  it("records bounded results and delegates payment-session cancellation", async () => {
    const input = fixture()
    const run = jest.fn(async () => undefined)
    deleteWorkflowMock.mockReturnValue({ run } as never)
    removeMock.mockImplementation(async ({ cancelPaymentSessions }) => {
      await cancelPaymentSessions(["payses_01"])
      return {
        capped: false,
        cutoff: "2026-07-24T04:37:00.000Z",
        deleted: 1,
        paymentCollectionsCanceled: 1,
        protectedByOrder: 2,
        protectedByPayment: 3,
        scanned: 7,
      }
    })

    await expect(
      removeAbandonedGuestCheckoutsJob(input.container)
    ).resolves.toBeUndefined()

    expect(input.lockingService.execute).toHaveBeenCalledWith(
      "jobs:abandoned-checkout-retention",
      expect.any(Function),
      { timeout: 5 }
    )
    expect(run).toHaveBeenCalledWith({ input: { ids: ["payses_01"] } })
    expect(writeEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          deleted: 1,
          job: "abandoned_checkout",
          paymentCollectionsCanceled: 1,
          protectedByOrder: 2,
          protectedByPayment: 3,
          scanned: 7,
          status: "completed",
        }),
        level: "info",
      })
    )
  })

  it("persists a failed heartbeat before propagating cleanup errors", async () => {
    const input = fixture()
    removeMock.mockRejectedValue(new Error("cleanup failed"))

    await expect(
      removeAbandonedGuestCheckoutsJob(input.container)
    ).rejects.toThrow("cleanup failed")

    expect(writeEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          job: "abandoned_checkout",
          status: "failed",
        }),
        level: "error",
      })
    )
  })
})
