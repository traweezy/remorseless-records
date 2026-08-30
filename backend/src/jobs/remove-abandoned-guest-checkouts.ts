import { deletePaymentSessionsWorkflow } from "@medusajs/core-flows"
import type {
  ICartModuleService,
  ILockingModule,
  Logger,
  MedusaContainer,
} from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import {
  ABANDONED_CHECKOUT_RETENTION_JOB_LOCK,
  type AbandonedCheckoutQuery,
  removeAbandonedGuestCheckouts,
  resolveAbandonedCheckoutRetentionConfig,
} from "../lib/abandoned-checkout-retention"
import { writeRetentionJobEvent } from "../lib/observability/retention-job"

export default async function removeAbandonedGuestCheckoutsJob(
  container: MedusaContainer
) {
  const logger = container.resolve<Logger>("logger")
  const runId = randomUUID()
  const startedAt = new Date()
  const timingStartedAt = performance.now()

  try {
    const retentionConfig = resolveAbandonedCheckoutRetentionConfig()
    if (!retentionConfig.enabled) {
      await writeRetentionJobEvent({
        input: {
          deleted: 0,
          durationMs: performance.now() - timingStartedAt,
          job: "abandoned_checkout",
          paymentCollectionsCanceled: 0,
          protectedByOrder: 0,
          protectedByPayment: 0,
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
    const query = container.resolve<AbandonedCheckoutQuery>(
      ContainerRegistrationKeys.QUERY
    )
    const result = await lockingService.execute(
      ABANDONED_CHECKOUT_RETENTION_JOB_LOCK,
      () =>
        removeAbandonedGuestCheckouts({
          cartService,
          lockingService,
          query,
          config: retentionConfig,
          cancelPaymentSessions: async (paymentSessionIds) => {
            await deletePaymentSessionsWorkflow(container).run({
              input: {
                ids: paymentSessionIds,
              },
            })
          },
        }),
      { timeout: 5 }
    )
    await writeRetentionJobEvent({
      input: {
        capped: result.capped,
        cutoff: result.cutoff,
        deleted: result.deleted,
        durationMs: performance.now() - timingStartedAt,
        job: "abandoned_checkout",
        paymentCollectionsCanceled: result.paymentCollectionsCanceled,
        protectedByOrder: result.protectedByOrder,
        protectedByPayment: result.protectedByPayment,
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
        job: "abandoned_checkout",
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
  name: "remove-abandoned-guest-checkouts",
  schedule: "37 4 * * *",
}
import { randomUUID } from "node:crypto"
import { performance } from "node:perf_hooks"
