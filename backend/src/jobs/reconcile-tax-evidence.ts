import type {
  ILockingModule,
  Logger,
  MedusaContainer,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import Stripe from "stripe"

import { STRIPE_API_KEY } from "../lib/constants"
import { reconcileTaxQuoteEvidence } from "../lib/tax-control/evidence-reconciliation"
import {
  taxEvidenceLockKey,
  type TaxQuoteEvidenceStatus,
} from "../modules/tax-control/constants"
import type TaxControlModuleService from "../modules/tax-control/service"
import { taxQuoteEvidenceListFrom } from "../modules/tax-control/persistence-contracts"

const RECONCILIATION_LIMIT = 100
const RECONCILABLE_STATUSES: TaxQuoteEvidenceStatus[] = [
  "association_failed",
  "disputed",
  "failed",
  "partially_refunded",
  "prepared",
  "refunded",
  "succeeded",
]

export default async function reconcileTaxEvidenceJob(
  container: MedusaContainer
): Promise<void> {
  if (!STRIPE_API_KEY) {
    return
  }

  const logger = container.resolve<Logger>("logger")
  const service = container.resolve<TaxControlModuleService>("tax_control")
  const locking = container.resolve<ILockingModule>(Modules.LOCKING)
  const candidates = taxQuoteEvidenceListFrom(
    await service.listTaxQuoteEvidences(
      { status: RECONCILABLE_STATUSES },
      {
        order: { last_verified_at: "ASC" },
        take: RECONCILIATION_LIMIT + 1,
      }
    ),
    RECONCILIATION_LIMIT + 1,
    "The tax evidence reconciliation queue returned invalid stored state."
  )
  const evidence = candidates.slice(0, RECONCILIATION_LIMIT)
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
  let needsAttention = 0
  for (const record of evidence) {
    try {
      const result = await locking.execute(
        taxEvidenceLockKey(record.payment_intent_id),
        () =>
          reconcileTaxQuoteEvidence({
            client,
            ...(record.order_id ? { orderId: record.order_id } : {}),
            onRetry: (event) => {
              logger.warn(
                `[tax-evidence] Stripe safe-read retry scheduled (${event.operation}, ${event.reason}, attempt ${event.attempt}/${event.totalAttempts}).`
              )
            },
            paymentIntentId: record.payment_intent_id,
            service,
          }),
        { timeout: 5 }
      )
      if (
        result.status === "association_failed" ||
        result.status === "disputed"
      ) {
        needsAttention += 1
      }
    } catch {
      failed += 1
      logger.error(
        "[tax-evidence] reconciliation failed (provider boundary or persistence error)."
      )
    }
  }

  const summary = {
    capped: candidates.length > RECONCILIATION_LIMIT,
    failed,
    inspected: evidence.length,
    needsAttention,
  }
  if (failed || needsAttention || summary.capped) {
    logger.warn(
      `Tax evidence reconciliation needs attention: ${JSON.stringify(summary)}`
    )
    return
  }
  logger.info(
    `Tax evidence reconciliation completed: ${JSON.stringify(summary)}`
  )
}

export const config = {
  name: "reconcile-tax-evidence",
  schedule: "23 * * * *",
}
