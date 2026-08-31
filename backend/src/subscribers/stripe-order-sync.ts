import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import type { ILockingModule } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import Stripe from "stripe"

import { STRIPE_API_KEY } from "@/lib/constants"
import { readNonNegativeSafeInteger } from "@/lib/provider-boundary/primitives"
import {
  asUnknownRecord,
  readProviderDataRecords,
  type UnknownRecord,
} from "@/lib/provider-boundary/records"
import { reconcileTaxQuoteEvidence } from "@/lib/tax-control/evidence-reconciliation"
import { taxEvidenceLockKey } from "@/modules/tax-control/constants"
import type TaxControlModuleService from "@/modules/tax-control/service"
import {
  stripePaymentReferencesFromOrder,
  syncStripeOrderReferences,
  type StripeOrderSyncClient,
} from "@/lib/stripe/order-sync"

type OrderPlacedData = {
  id: string
}

type QueryGraph = {
  graph: (input: {
    entity: string
    fields: string[]
    filters: Record<string, unknown>
    pagination: { take: number }
  }) => Promise<unknown>
}

type Logger = {
  info: (message: string) => void
  warn: (message: string) => void
}

const orderIdFrom = (value: unknown): string | null =>
  typeof value === "string" &&
  value.length <= 255 &&
  /^order_[A-Za-z0-9]+$/.test(value)
    ? value
    : null

const orderFrom = (value: unknown, expectedId: string): UnknownRecord => {
  try {
    const records = readProviderDataRecords(value, "Stripe order sync query")
    const [order] = records
    if (
      records.length !== 1 ||
      !order ||
      orderIdFrom(order.id) !== expectedId
    ) {
      throw new Error()
    }
    return order
  } catch {
    throw new Error("Stripe order sync returned an invalid order projection")
  }
}

export default async function stripeOrderSyncHandler({
  event: { data },
  container,
}: SubscriberArgs<OrderPlacedData>): Promise<void> {
  if (!STRIPE_API_KEY) {
    return
  }

  const orderId = orderIdFrom(asUnknownRecord(data)?.id)
  if (!orderId) {
    throw new Error("Stripe order sync received an invalid order identity")
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger
  const result = await query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "payment_collections.payments.provider_id",
      "payment_collections.payments.amount",
      "payment_collections.payments.currency_code",
      "payment_collections.payments.data",
      "payment_collections.payments.status",
      "payment_collections.payments.captured_at",
      "payment_collections.payments.authorized_at",
      "payment_collections.payment_sessions.provider_id",
      "payment_collections.payment_sessions.amount",
      "payment_collections.payment_sessions.currency_code",
      "payment_collections.payment_sessions.data",
      "payment_collections.payment_sessions.status",
    ],
    filters: { id: orderId },
    pagination: { take: 1 },
  })
  const order = orderFrom(result, orderId)

  const displayId = readNonNegativeSafeInteger(order.display_id)
  if (displayId === null || displayId <= 0) {
    throw new Error("Stripe order sync requires an order number")
  }
  const orderNumber = String(displayId)

  const references = stripePaymentReferencesFromOrder(order)
  if (!references.length) {
    return
  }

  const stripe = new Stripe(STRIPE_API_KEY, {
    appInfo: {
      name: "remorseless-records-medusa",
      version: "1.0.0",
    },
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 0,
    timeout: 10_000,
  })
  const synchronizedCount = await syncStripeOrderReferences({
    client: stripe as StripeOrderSyncClient,
    onRetry: (event) => {
      logger.warn(
        `[stripe-order-sync] Stripe annotation retry scheduled (${event.operation}, ${event.reason}, attempt ${event.attempt}/${event.totalAttempts}).`
      )
    },
    orderId,
    orderNumber,
    references,
  })

  const service = container.resolve<TaxControlModuleService>("tax_control")
  const locking = container.resolve<ILockingModule>(Modules.LOCKING)
  for (const reference of references) {
    await locking.execute(
      taxEvidenceLockKey(reference.paymentIntentId),
      () =>
        reconcileTaxQuoteEvidence({
          client: stripe,
          onRetry: (event) => {
            logger.warn(
              `[tax-evidence] Stripe safe-read retry scheduled (${event.operation}, ${event.reason}, attempt ${event.attempt}/${event.totalAttempts}).`
            )
          },
          orderId,
          paymentIntentId: reference.paymentIntentId,
          service,
        }),
      { timeout: 5 }
    )
  }

  logger.info(
    `[stripe-order-sync] synchronized ${synchronizedCount} payment reference(s)`
  )
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
