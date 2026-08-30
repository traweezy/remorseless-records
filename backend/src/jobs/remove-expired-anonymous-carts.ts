import type {
  ICartModuleService,
  ILockingModule,
  Logger,
  MedusaContainer,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

import {
  CART_RETENTION_JOB_LOCK,
  removeExpiredAnonymousCarts,
  resolveCartRetentionConfig,
} from "../lib/cart-retention"
import { writeRetentionJobEvent } from "../lib/observability/retention-job"

export default async function removeExpiredAnonymousCartsJob(
  container: MedusaContainer
) {
  const logger = container.resolve<Logger>("logger")
  const runId = randomUUID()
  const startedAt = new Date()
  const timingStartedAt = performance.now()

  try {
    const retentionConfig = resolveCartRetentionConfig()
    if (!retentionConfig.enabled) {
      await writeRetentionJobEvent({
        input: {
          deleted: 0,
          durationMs: performance.now() - timingStartedAt,
          job: "anonymous_cart",
          protectedByEmail: 0,
          runId,
          scanned: 0,
          startedAt,
          status: "disabled",
        },
        level: "info",
        logger,
      })
      return
    }

    const cartService = container.resolve<ICartModuleService>(Modules.CART)
    const lockingService = container.resolve<ILockingModule>(Modules.LOCKING)
    const result = await lockingService.execute(
      CART_RETENTION_JOB_LOCK,
      () =>
        removeExpiredAnonymousCarts({
          cartService,
          lockingService,
          config: retentionConfig,
        }),
      { timeout: 5 }
    )
    await writeRetentionJobEvent({
      input: {
        capped: result.capped,
        cutoff: result.cutoff,
        deleted: result.deleted,
        durationMs: performance.now() - timingStartedAt,
        job: "anonymous_cart",
        protectedByEmail: result.protectedByEmail,
        runId,
        scanned: result.scanned,
        startedAt,
        status: "completed",
      },
      level: result.capped ? "warn" : "info",
      logger,
    })
  } catch (error) {
    await writeRetentionJobEvent({
      input: {
        durationMs: performance.now() - timingStartedAt,
        job: "anonymous_cart",
        runId,
        startedAt,
        status: "failed",
      },
      level: "error",
      logger,
    })
    throw error
  }
}

export const config = {
  name: "remove-expired-anonymous-carts",
  schedule: "17 4 * * *",
}
import { randomUUID } from "node:crypto"
import { performance } from "node:perf_hooks"
