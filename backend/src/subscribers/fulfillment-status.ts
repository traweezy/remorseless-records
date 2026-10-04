import type { INotificationModuleService } from "@medusajs/framework/types"
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import {
  ContainerRegistrationKeys,
  FulfillmentWorkflowEvents,
  Modules,
  OrderWorkflowEvents,
} from "@medusajs/framework/utils"

import {
  createAndVerifyNotifications,
  readNotificationEmail,
  readNotificationEntityId,
} from "../lib/notifications/contracts"
import {
  readIsoTimestamp,
  readNonNegativeSafeInteger,
} from "../lib/provider-boundary/primitives"
import {
  asUnknownRecord,
  readProviderDataRecords,
} from "../lib/provider-boundary/records"
import { emailIdempotencyFields } from "../modules/email-notifications/idempotency"
import { EmailTemplates } from "../modules/email-notifications/templates"
import {
  FULFILLMENT_COPY,
  type FulfillmentStatus,
} from "../modules/email-notifications/templates/fulfillment-status"

type FulfillmentEvent = {
  id: string
  fulfillment_id?: string
  no_notification?: boolean
}

type QueryGraph = {
  graph: (input: {
    entity: string
    fields: string[]
    filters: Record<string, unknown>
  }) => Promise<unknown>
}

const malformed = (): Error =>
  new Error("Fulfillment notification state is malformed.")

const statusForEvent = (name: string): FulfillmentStatus => {
  if (name === OrderWorkflowEvents.FULFILLMENT_CREATED) return "prepared"
  if (name === FulfillmentWorkflowEvents.SHIPMENT_CREATED) return "shipped"
  if (name === FulfillmentWorkflowEvents.DELIVERY_CREATED) return "delivered"
  throw malformed()
}

export default async function fulfillmentStatusHandler({
  event,
  container,
}: SubscriberArgs<FulfillmentEvent>): Promise<void> {
  const status = statusForEvent(event.name)
  const data = asUnknownRecord(event.data)
  if (
    !data ||
    (data.no_notification !== undefined &&
      typeof data.no_notification !== "boolean")
  ) {
    throw malformed()
  }
  const fulfillmentId = readNotificationEntityId(
    status === "prepared" ? data.fulfillment_id : data.id,
    "ful"
  )
  const expectedOrderId =
    status === "prepared" ? readNotificationEntityId(data.id, "order") : null
  if (!fulfillmentId || (status === "prepared" && !expectedOrderId)) {
    throw malformed()
  }
  if (data.no_notification === true) return

  const query = container.resolve<QueryGraph>(ContainerRegistrationKeys.QUERY)
  const records = readProviderDataRecords(
    await query.graph({
      entity: "fulfillment",
      fields: [
        "id",
        "created_at",
        "shipped_at",
        "delivered_at",
        "canceled_at",
        "order.id",
        "order.display_id",
        "order.email",
        "order.customer_id",
        "order.status",
      ],
      filters: { id: fulfillmentId },
    }),
    "Fulfillment notification query"
  )
  const fulfillment = records[0]
  if (
    records.length !== 1 ||
    !fulfillment ||
    fulfillment.id !== fulfillmentId
  ) {
    throw malformed()
  }
  if (fulfillment.canceled_at != null) {
    if (!readIsoTimestamp(fulfillment.canceled_at)) throw malformed()
    return
  }
  const order = asUnknownRecord(fulfillment.order)
  if (!order && fulfillment.order == null && status !== "prepared") return
  const orderId = readNotificationEntityId(order?.id, "order")
  const displayId = readNonNegativeSafeInteger(order?.display_id)
  const eventTimestamp = readIsoTimestamp(
    status === "prepared"
      ? fulfillment.created_at
      : status === "shipped"
        ? fulfillment.shipped_at
        : fulfillment.delivered_at
  )
  const customerId =
    order?.customer_id == null
      ? null
      : readNotificationEntityId(order.customer_id, "cus")
  if (
    !order ||
    !orderId ||
    (expectedOrderId && orderId !== expectedOrderId) ||
    !displayId ||
    !eventTimestamp ||
    (order.customer_id != null && !customerId) ||
    typeof order.status !== "string" ||
    !["pending", "completed", "draft", "canceled", "archived"].includes(
      order.status
    )
  ) {
    throw malformed()
  }
  if (order.status === "canceled" || order.email == null) return
  const email = readNotificationEmail(order.email)
  if (!email) throw malformed()

  const notificationService = container.resolve<INotificationModuleService>(
    Modules.NOTIFICATION
  )
  // This projection excludes mutable tracking labels, address and item data,
  // keeping the same business operation's provider payload stable on retries.
  await createAndVerifyNotifications(notificationService, [
    {
      ...emailIdempotencyFields(
        `fulfillment-status:${fulfillmentId}:${status}`
      ),
      channel: "email",
      data: {
        emailOptions: { subject: FULFILLMENT_COPY[status].title },
        orderDisplayId: displayId,
        status,
      },
      receiver_id: customerId,
      resource_id: orderId,
      resource_type: "order",
      template: EmailTemplates.FULFILLMENT_STATUS,
      to: email,
      trigger_type: event.name,
    },
  ])
}

export const config: SubscriberConfig = {
  event: [
    OrderWorkflowEvents.FULFILLMENT_CREATED,
    FulfillmentWorkflowEvents.SHIPMENT_CREATED,
    FulfillmentWorkflowEvents.DELIVERY_CREATED,
  ],
}
