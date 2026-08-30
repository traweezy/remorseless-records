import type {
  ILockingModule,
  Logger,
  MedusaContainer,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import Stripe from "stripe"

import { STRIPE_API_KEY } from "../lib/constants"
import { processStripeLifecycleEvent } from "../lib/payment-lifecycle/process-stripe-event"
import { stripeLifecycleRecordFrom } from "../lib/payment-lifecycle/contracts"
import {
  PAYMENT_LIFECYCLE_MODULE,
  stripeLifecycleLockKey,
} from "../modules/payment-lifecycle/constants"
import type PaymentLifecycleModuleService from "../modules/payment-lifecycle/service"
import type TaxControlModuleService from "../modules/tax-control/service"

const RECONCILIATION_LIMIT = 100
const PROCESSING_STALE_MS = 15 * 60 * 1_000

export const stripeLifecycleEventIsDue = (
  record: {
    next_retry_at: unknown
    processing_started_at: unknown
    status: unknown
  },
  now: Date
): boolean => {
  if (!Number.isFinite(now.getTime())) {
    throw new TypeError("The Stripe lifecycle reconciliation clock is invalid.")
  }
  if (
    record.next_retry_at !== null &&
    (!(record.next_retry_at instanceof Date) ||
      !Number.isFinite(record.next_retry_at.getTime()))
  ) {
    throw new TypeError("The Stripe lifecycle retry timestamp is invalid.")
  }
  if (
    record.processing_started_at !== null &&
    (!(record.processing_started_at instanceof Date) ||
      !Number.isFinite(record.processing_started_at.getTime()))
  ) {
    throw new TypeError("The Stripe lifecycle processing timestamp is invalid.")
  }
  if (record.status === "received") {
    return true
  }
  if (record.status === "failed") {
    return (
      !record.next_retry_at || record.next_retry_at.getTime() <= now.getTime()
    )
  }
  if (record.status === "processing") {
    return Boolean(
      record.processing_started_at &&
        record.processing_started_at.getTime() <=
          now.getTime() - PROCESSING_STALE_MS
    )
  }
  if (record.status === "processed" || record.status === "ignored") {
    return false
  }
  throw new TypeError("The Stripe lifecycle reconciliation status is invalid.")
}

export default async function reconcileStripeLifecycleEventsJob(
  container: MedusaContainer
): Promise<void> {
  if (!STRIPE_API_KEY) {
    return
  }

  const now = new Date()
  const logger = container.resolve<Logger>("logger")
  const lifecycleService = container.resolve<PaymentLifecycleModuleService>(
    PAYMENT_LIFECYCLE_MODULE
  )
  const taxControlService =
    container.resolve<TaxControlModuleService>("tax_control")
  const locking = container.resolve<ILockingModule>(Modules.LOCKING)
  const candidateRows = await lifecycleService.listStripeLifecycleEvents(
    { status: ["received", "processing", "failed"] },
    {
      order: { received_at: "ASC" },
      take: RECONCILIATION_LIMIT,
    }
  )
  let invalid = 0
  const candidates = candidateRows.flatMap((record) => {
    try {
      return [stripeLifecycleRecordFrom(record)]
    } catch {
      invalid += 1
      return []
    }
  })
  const due = candidates.filter((record) =>
    stripeLifecycleEventIsDue(record, now)
  )
  const client = new Stripe(STRIPE_API_KEY, {
    appInfo: {
      name: "remorseless-records-medusa",
      version: "1.0.0",
    },
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 0,
    timeout: 10_000,
  })

  let failed = 0
  let ignored = 0
  for (const record of due) {
    try {
      const result = await locking.execute(
        stripeLifecycleLockKey(record.id),
        () =>
          processStripeLifecycleEvent({
            client,
            eventId: record.id,
            lifecycleService,
            onRetry: (event) => {
              logger.warn(
                `Stripe lifecycle safe-read retry scheduled (${event.operation}, ${event.reason}, attempt ${event.attempt}/${event.totalAttempts}).`
              )
            },
            taxControlService,
          }),
        { timeout: 10 }
      )
      if (result.status === "ignored") {
        ignored += 1
      }
    } catch {
      failed += 1
    }
  }

  const summary = {
    capped: candidateRows.length === RECONCILIATION_LIMIT,
    due: due.length,
    failed,
    ignored,
    inspected: candidateRows.length,
    invalid,
  }
  if (failed || ignored || invalid || summary.capped) {
    logger.warn(
      `Stripe lifecycle reconciliation needs attention: ${JSON.stringify(summary)}`
    )
    return
  }
  logger.info(
    `Stripe lifecycle reconciliation completed: ${JSON.stringify(summary)}`
  )
}

export const config = {
  name: "reconcile-stripe-lifecycle-events",
  schedule: "*/5 * * * *",
}
