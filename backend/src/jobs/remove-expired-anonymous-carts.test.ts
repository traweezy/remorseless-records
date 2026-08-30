import { Modules } from "@medusajs/framework/utils"

import {
  removeExpiredAnonymousCarts,
  resolveCartRetentionConfig,
} from "../lib/cart-retention"
import { writeRetentionJobEvent } from "../lib/observability/retention-job"
import removeExpiredAnonymousCartsJob, {
  config,
} from "./remove-expired-anonymous-carts"

jest.mock("../lib/cart-retention", () => ({
  CART_RETENTION_JOB_LOCK: "jobs:anonymous-cart-retention",
  removeExpiredAnonymousCarts: jest.fn(),
  resolveCartRetentionConfig: jest.fn(),
}))
jest.mock("../lib/observability/retention-job", () => ({
  writeRetentionJobEvent: jest.fn(async () => undefined),
}))

const removeMock = removeExpiredAnonymousCarts as jest.MockedFunction<
  typeof removeExpiredAnonymousCarts
>
const resolveConfigMock = resolveCartRetentionConfig as jest.MockedFunction<
  typeof resolveCartRetentionConfig
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
    throw new Error(`Unexpected container key: ${key}`)
  })

  return {
    cartService,
    container: { resolve } as never,
    lockingService,
    logger,
    resolve,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  resolveConfigMock.mockReturnValue({
    enabled: true,
    maxDeletionsPerRun: 1_000,
    retentionDays: 37,
  })
  removeMock.mockResolvedValue({
    capped: false,
    cutoff: "2026-07-24T04:17:00.000Z",
    deleted: 2,
    protectedByEmail: 1,
    scanned: 3,
  })
})

describe("anonymous cart retention job", () => {
  it("retains the reviewed daily schedule", () => {
    expect(config).toEqual({
      name: "remove-expired-anonymous-carts",
      schedule: "17 4 * * *",
    })
  })

  it("records a disabled heartbeat without resolving mutation services", async () => {
    const input = fixture()
    resolveConfigMock.mockReturnValue({
      enabled: false,
      maxDeletionsPerRun: 1_000,
      retentionDays: 37,
    })

    await expect(
      removeExpiredAnonymousCartsJob(input.container)
    ).resolves.toBeUndefined()

    expect(input.resolve).toHaveBeenCalledTimes(1)
    expect(removeMock).not.toHaveBeenCalled()
    expect(writeEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          deleted: 0,
          job: "anonymous_cart",
          scanned: 0,
          status: "disabled",
        }),
        level: "info",
        logger: input.logger,
      })
    )
  })

  it("runs under the distributed lock and records bounded results", async () => {
    const input = fixture()

    await expect(
      removeExpiredAnonymousCartsJob(input.container)
    ).resolves.toBeUndefined()

    expect(input.lockingService.execute).toHaveBeenCalledWith(
      "jobs:anonymous-cart-retention",
      expect.any(Function),
      { timeout: 5 }
    )
    expect(removeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cartService: input.cartService,
        lockingService: input.lockingService,
      })
    )
    expect(writeEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          deleted: 2,
          job: "anonymous_cart",
          protectedByEmail: 1,
          scanned: 3,
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
      removeExpiredAnonymousCartsJob(input.container)
    ).rejects.toThrow("cleanup failed")

    expect(writeEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          job: "anonymous_cart",
          status: "failed",
        }),
        level: "error",
      })
    )
  })
})
