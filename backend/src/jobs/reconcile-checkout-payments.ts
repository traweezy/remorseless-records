import { completeCartWorkflow } from "@medusajs/core-flows"
import type {
  ILockingModule,
  Logger,
  MedusaContainer,
} from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import {
  CHECKOUT_RECONCILIATION_JOB_LOCK,
  type CheckoutReconciliationQuery,
  reconcileCheckoutPayments,
  resolveCheckoutReconciliationConfig,
} from "../lib/checkout/reconciliation"

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export default async function reconcileCheckoutPaymentsJob(
  container: MedusaContainer
) {
  const logger = container.resolve<Logger>("logger")

  try {
    const reconciliationConfig = resolveCheckoutReconciliationConfig()
    if (!reconciliationConfig.enabled) {
      return
    }

    const lockingService = container.resolve<ILockingModule>(Modules.LOCKING)
    const query = container.resolve<CheckoutReconciliationQuery>(
      ContainerRegistrationKeys.QUERY
    )
    const result = await lockingService.execute(
      CHECKOUT_RECONCILIATION_JOB_LOCK,
      () =>
        reconcileCheckoutPayments({
          query,
          config: reconciliationConfig,
          completeCart: async (cartId) => {
            await completeCartWorkflow(container).run({
              input: { id: cartId },
            })
          },
        }),
      { timeout: 5 }
    )

    if (result.failed > 0 || result.capped) {
      logger.warn(
        `Checkout reconciliation needs attention: ${JSON.stringify(result)}`
      )
      return
    }
    logger.info(`Checkout reconciliation completed: ${JSON.stringify(result)}`)
  } catch (error) {
    logger.error(`Checkout reconciliation failed: ${errorMessage(error)}`)
    throw error
  }
}

export const config = {
  name: "reconcile-checkout-payments",
  schedule: "*/2 * * * *",
}
