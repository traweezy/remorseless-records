import type {
  INotificationModuleService,
  IPaymentModuleService,
  Logger,
} from "@medusajs/framework/types"
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { buildRefundNotificationPayloads } from "../lib/refund-operations/notification"
import { EmailTemplates } from "../modules/email-notifications/templates"

type PaymentRefundedEvent = {
  id: string
}

type UnknownRecord = Record<string, unknown>

type QueryGraph = {
  graph: (input: {
    entity: string
    fields: string[]
    filters: Record<string, unknown>
  }) => Promise<{ data: UnknownRecord[] }>
}

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null

const integer = (value: unknown): number | null => {
  const numeric = Number(value)
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null
}

export default async function refundIssuedHandler({
  event: { data },
  container,
}: SubscriberArgs<PaymentRefundedEvent>): Promise<void> {
  const paymentService = container.resolve<IPaymentModuleService>(
    Modules.PAYMENT
  )
  const payment = await paymentService.retrievePayment(data.id, {
    relations: ["refunds"],
  })
  if (!payment.refunds?.length) {
    return
  }

  const query = container.resolve<QueryGraph>(ContainerRegistrationKeys.QUERY)
  const { data: collections } = await query.graph({
    entity: "payment_collection",
    fields: [
      "id",
      "order.id",
      "order.display_id",
      "order.email",
      "order.customer_id",
      "order.currency_code",
      "cart.id",
      "cart.email",
      "cart.currency_code",
    ],
    filters: { id: payment.payment_collection_id },
  })
  const collection = collections[0]
  const order = asRecord(collection?.order)
  const cart = asRecord(collection?.cart)
  const orderDisplayId = integer(order?.display_id)
  const email = text(order?.email) ?? text(cart?.email)
  const resourceId = text(order?.id) ?? text(cart?.id)
  const resourceType = text(order?.id) ? "order" : "cart"
  const logger = container.resolve<Logger>("logger")
  if (!email || !resourceId) {
    logger.warn(
      `[refund-notification] payment ${payment.id} has no order/cart recipient`
    )
    return
  }

  const notifications = buildRefundNotificationPayloads({
    context: {
      currencyCode:
        text(payment.currency_code)?.toLowerCase() ??
        text(order?.currency_code)?.toLowerCase() ??
        text(cart?.currency_code)?.toLowerCase() ??
        "",
      customerId: text(order?.customer_id),
      email,
      referenceLabel:
        orderDisplayId === null
          ? "your checkout payment"
          : `order #${orderDisplayId}`,
      refunds: payment.refunds.map((refund) => ({
        amount: refund.raw_amount ?? refund.amount,
        id: refund.id,
        ...(refund.note !== undefined ? { note: refund.note } : {}),
      })),
      resourceId,
      resourceType,
    },
    template: EmailTemplates.REFUND_ISSUED,
  })
  if (!notifications.length) {
    throw new Error(
      `Refund notification data is invalid for payment ${payment.id}.`
    )
  }

  const notificationService = container.resolve<INotificationModuleService>(
    Modules.NOTIFICATION
  )
  await notificationService.createNotifications(notifications)
  logger.info(
    `[refund-notification] recorded ${notifications.length} idempotent customer notification(s) for payment ${payment.id}`
  )
}

export const config: SubscriberConfig = {
  event: "payment.refunded",
}
