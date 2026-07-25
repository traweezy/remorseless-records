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

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export default async function removeAbandonedGuestCheckoutsJob(
  container: MedusaContainer
) {
  const logger = container.resolve<Logger>("logger")

  try {
    const retentionConfig = resolveAbandonedCheckoutRetentionConfig()
    if (!retentionConfig.enabled) {
      logger.info(
        "Abandoned checkout retention is disabled; no checkouts were inspected or changed"
      )
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
    logger.info(
      `Abandoned checkout retention completed: ${JSON.stringify(result)}`
    )
  } catch (error) {
    logger.error(`Abandoned checkout retention failed: ${errorMessage(error)}`)
    throw error
  }
}

export const config = {
  name: "remove-abandoned-guest-checkouts",
  schedule: "37 4 * * *",
}
