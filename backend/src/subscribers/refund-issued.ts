import type {
  INotificationModuleService,
  IPaymentModuleService,
  Logger,
} from "@medusajs/framework/types"
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { buildRefundNotificationPayloads } from "../lib/refund-operations/notification"
import {
  createAndVerifyNotifications,
  readNotificationEmail,
} from "../lib/notifications/contracts"
import { readNonNegativeSafeInteger } from "../lib/provider-boundary/primitives"
import {
  asUnknownRecord,
  readProviderDataRecords,
  readRecordArray,
  readRequiredRecord,
  type UnknownRecord,
} from "../lib/provider-boundary/records"
import { EmailTemplates } from "../modules/email-notifications/templates"

type PaymentRefundedEvent = {
  id: string
}

type QueryGraph = {
  graph: (input: {
    entity: string
    fields: string[]
    filters: Record<string, unknown>
  }) => Promise<unknown>
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null

const boundedId = (value: unknown): string | null => {
  const id = text(value)
  return id && id.length <= 255 && /^[A-Za-z0-9_-]+$/.test(id) ? id : null
}

const malformedRefundProjection = (): Error =>
  new Error("Refund notification payment data is malformed.")

const optionalText = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== "string") {
    throw malformedRefundProjection()
  }
  return value.trim() || null
}

const optionalBoundedId = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null
  }
  const id = boundedId(value)
  if (!id) {
    throw malformedRefundProjection()
  }
  return id
}

const optionalCurrency = (value: unknown): string | null => {
  const currency = optionalText(value)?.toLowerCase() ?? null
  if (currency !== null && !/^[a-z]{3}$/.test(currency)) {
    throw malformedRefundProjection()
  }
  return currency
}

export default async function refundIssuedHandler({
  event: { data },
  container,
}: SubscriberArgs<PaymentRefundedEvent>): Promise<void> {
  const paymentService = container.resolve<IPaymentModuleService>(
    Modules.PAYMENT
  )
  const eventPaymentId = boundedId(asUnknownRecord(data)?.id)
  if (!eventPaymentId) {
    throw malformedRefundProjection()
  }
  const paymentValue: unknown = await paymentService.retrievePayment(
    eventPaymentId,
    { relations: ["refunds"] }
  )
  let payment: UnknownRecord
  let refunds: UnknownRecord[]
  try {
    payment = readRequiredRecord(paymentValue, "Refund notification payment")
    refunds = readRecordArray(payment.refunds, {
      context: "Refund notification refund query",
      optional: true,
    })
  } catch {
    throw malformedRefundProjection()
  }
  const paymentId = boundedId(payment.id)
  const paymentCollectionId = boundedId(payment.payment_collection_id)
  if (paymentId !== eventPaymentId || !paymentCollectionId) {
    throw malformedRefundProjection()
  }
  if (!refunds.length) {
    return
  }

  const query = container.resolve<QueryGraph>(ContainerRegistrationKeys.QUERY)
  const result = await query.graph({
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
    filters: { id: paymentCollectionId },
  })
  let collection: UnknownRecord
  try {
    const collections = readProviderDataRecords(
      result,
      "Refund notification payment-collection query"
    )
    const [record] = collections
    if (collections.length !== 1 || !record) {
      throw malformedRefundProjection()
    }
    collection = record
  } catch {
    throw malformedRefundProjection()
  }
  if (boundedId(collection.id) !== paymentCollectionId) {
    throw malformedRefundProjection()
  }
  const order = asUnknownRecord(collection.order)
  const cart = asUnknownRecord(collection.cart)
  if (
    (collection.order !== null && collection.order !== undefined && !order) ||
    (collection.cart !== null && collection.cart !== undefined && !cart)
  ) {
    throw malformedRefundProjection()
  }
  const orderId = order ? boundedId(order.id) : null
  const cartId = cart ? boundedId(cart.id) : null
  const parsedOrderDisplayId = order
    ? readNonNegativeSafeInteger(order.display_id)
    : null
  if ((order && (!orderId || !parsedOrderDisplayId)) || (cart && !cartId)) {
    throw malformedRefundProjection()
  }
  const orderEmail =
    order?.email === null || order?.email === undefined
      ? null
      : readNotificationEmail(order.email)
  const cartEmail =
    cart?.email === null || cart?.email === undefined
      ? null
      : readNotificationEmail(cart.email)
  if (
    (order?.email !== null && order?.email !== undefined && !orderEmail) ||
    (cart?.email !== null && cart?.email !== undefined && !cartEmail)
  ) {
    throw malformedRefundProjection()
  }
  const paymentCurrency = optionalCurrency(payment.currency_code)
  const orderCurrency = optionalCurrency(order?.currency_code)
  const cartCurrency = optionalCurrency(cart?.currency_code)
  const customerId = optionalBoundedId(order?.customer_id)
  const email = orderEmail ?? cartEmail
  const resourceId = orderId ?? cartId
  const resourceType = orderId ? "order" : "cart"
  const logger = container.resolve<Logger>("logger")
  if (!email || !resourceId) {
    logger.warn(
      `[refund-notification] payment ${paymentId} has no order/cart recipient`
    )
    return
  }

  const refundInputs = refunds.map((refund) => {
    const id = boundedId(refund.id)
    if (
      !id ||
      (refund.note !== null &&
        refund.note !== undefined &&
        typeof refund.note !== "string")
    ) {
      throw malformedRefundProjection()
    }
    return {
      amount: refund.raw_amount ?? refund.amount,
      id,
      ...(typeof refund.note === "string" ? { note: refund.note } : {}),
    }
  })
  const notifications = buildRefundNotificationPayloads({
    context: {
      currencyCode: paymentCurrency ?? orderCurrency ?? cartCurrency ?? "",
      customerId,
      email,
      referenceLabel:
        parsedOrderDisplayId === null
          ? "your checkout payment"
          : `order #${parsedOrderDisplayId}`,
      refunds: refundInputs,
      resourceId,
      resourceType,
    },
    template: EmailTemplates.REFUND_ISSUED,
  })
  if (notifications.length !== refundInputs.length) {
    throw new Error(
      `Refund notification data is invalid for payment ${paymentId}.`
    )
  }

  const notificationService = container.resolve<INotificationModuleService>(
    Modules.NOTIFICATION
  )
  await createAndVerifyNotifications(notificationService, notifications)
  logger.info(
    `[refund-notification] recorded ${notifications.length} idempotent customer notification(s) for payment ${paymentId}`
  )
}

export const config: SubscriberConfig = {
  event: "payment.refunded",
}
