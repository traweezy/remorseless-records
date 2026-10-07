import type { INotificationModuleService } from "@medusajs/framework/types"
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import {
  ContainerRegistrationKeys,
  Modules,
  OrderChangeStatus,
  OrderChangeType,
  OrderWorkflowEvents,
  ReturnStatus,
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
import { AFTER_SALES_COPY } from "../modules/email-notifications/templates/after-sales-status"

type AfterSalesEvent = {
  order_id?: string
  order_change_id?: string
  return_id?: string
  claim_id?: string
  exchange_id?: string
  return_status?: string
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
  new Error("After-sales notification state is malformed.")

const contracts = {
  [OrderWorkflowEvents.RETURN_REQUESTED]: {
    entity: "return",
    field: "return_id",
    prefix: "return",
    type: OrderChangeType.RETURN_REQUEST,
    status: "return-requested",
  },
  [OrderWorkflowEvents.RETURN_RECEIVED]: {
    entity: "return",
    field: "return_id",
    prefix: "return",
    type: OrderChangeType.RETURN_RECEIVE,
    status: "return-received",
  },
  [OrderWorkflowEvents.CLAIM_CREATED]: {
    entity: "order_claim",
    field: "claim_id",
    prefix: "claim",
    type: OrderChangeType.CLAIM,
    status: "claim-confirmed",
  },
  [OrderWorkflowEvents.EXCHANGE_CREATED]: {
    entity: "order_exchange",
    field: "exchange_id",
    prefix: "oexc",
    type: OrderChangeType.EXCHANGE,
    status: "exchange-confirmed",
  },
} as const

export default async function afterSalesStatusHandler({
  event,
  container,
}: SubscriberArgs<AfterSalesEvent>): Promise<void> {
  const contract = Object.hasOwn(contracts, event.name)
    ? contracts[event.name as keyof typeof contracts]
    : null
  const data = asUnknownRecord(event.data)
  if (
    !contract ||
    !data ||
    (data.no_notification !== undefined &&
      typeof data.no_notification !== "boolean")
  ) {
    throw malformed()
  }
  // Legacy/generic events carry no confirmation preference. Do not opt them
  // into customer email or replay historical notifications by implication.
  if (data.no_notification !== false) return
  const orderId = readNotificationEntityId(data.order_id, "order")
  const changeId = readNotificationEntityId(data.order_change_id, "ordch")
  const resourceId = readNotificationEntityId(
    data[contract.field],
    contract.prefix
  )
  if (!orderId || !changeId || !resourceId) throw malformed()
  if (contract.status === "return-received") {
    // Bind full-receipt copy to this confirmation, even if a delayed partial
    // event is retried after a later receipt with a different preference.
    if (data.return_status === ReturnStatus.PARTIALLY_RECEIVED) return
    if (data.return_status !== ReturnStatus.RECEIVED) throw malformed()
  }

  const query = container.resolve<QueryGraph>(ContainerRegistrationKeys.QUERY)
  const records = readProviderDataRecords(
    await query.graph({
      entity: contract.entity,
      fields: [
        "id",
        "order_id",
        "canceled_at",
        "created_at",
        ...(contract.entity === "return"
          ? ["status", "requested_at", "received_at"]
          : []),
        "order.id",
        "order.display_id",
        "order.email",
        "order.customer_id",
        "order.status",
      ],
      filters: { id: resourceId },
    }),
    "After-sales notification resource"
  )
  const resource = records[0]
  if (
    records.length !== 1 ||
    !resource ||
    resource.id !== resourceId ||
    resource.order_id !== orderId
  )
    throw malformed()
  if (resource.canceled_at != null) {
    if (!readIsoTimestamp(resource.canceled_at)) throw malformed()
    return
  }
  if (!readIsoTimestamp(resource.created_at)) throw malformed()
  if (contract.entity === "return") {
    if (!Object.values(ReturnStatus).includes(resource.status as ReturnStatus))
      throw malformed()
    if (resource.status === ReturnStatus.CANCELED) return
    if (!readIsoTimestamp(resource.requested_at)) throw malformed()
    if (contract.status === "return-received") {
      // Native workflows may emit this event for a partial receipt. The email
      // describes a complete receipt, so require its persisted state.
      if (resource.status === ReturnStatus.PARTIALLY_RECEIVED) return
      if (
        resource.status !== ReturnStatus.RECEIVED ||
        !readIsoTimestamp(resource.received_at)
      )
        throw malformed()
    }
  }
  const changes = readProviderDataRecords(
    await query.graph({
      entity: "order_change",
      fields: [
        "id",
        "order_id",
        contract.field,
        "change_type",
        "status",
        "confirmed_at",
        "canceled_at",
      ],
      filters: { id: changeId },
    }),
    "After-sales notification confirmation"
  )
  const change = changes[0]
  if (
    changes.length !== 1 ||
    !change ||
    change.id !== changeId ||
    change.order_id !== orderId ||
    change[contract.field] !== resourceId ||
    change.change_type !== contract.type
  )
    throw malformed()
  if (change.canceled_at != null) {
    if (!readIsoTimestamp(change.canceled_at)) throw malformed()
    return
  }
  if (
    change.status !== OrderChangeStatus.CONFIRMED ||
    !readIsoTimestamp(change.confirmed_at)
  )
    throw malformed()

  const order = asUnknownRecord(resource.order)
  const displayId = readNonNegativeSafeInteger(order?.display_id)
  const customerId =
    order?.customer_id == null
      ? null
      : readNotificationEntityId(order.customer_id, "cus")
  if (
    !order ||
    order.id !== orderId ||
    !displayId ||
    (order.customer_id != null && !customerId) ||
    typeof order.status !== "string" ||
    !["pending", "completed", "draft", "canceled", "archived"].includes(
      order.status
    )
  )
    throw malformed()
  if (
    order.status === "canceled" ||
    order.status === "draft" ||
    order.email == null
  )
    return
  const email = readNotificationEmail(order.email)
  if (!email) throw malformed()
  const notificationService = container.resolve<INotificationModuleService>(
    Modules.NOTIFICATION
  )
  // One immutable payload per confirmed resource/stage, independent of mutable
  // items, addresses, financial amounts and subsequent order changes.
  await createAndVerifyNotifications(notificationService, [
    {
      ...emailIdempotencyFields(
        `after-sales-status:${resourceId}:${contract.status}`
      ),
      channel: "email",
      receiver_id: customerId,
      resource_id: orderId,
      resource_type: "order",
      template: EmailTemplates.AFTER_SALES_STATUS,
      to: email,
      trigger_type: event.name,
      data: {
        emailOptions: { subject: AFTER_SALES_COPY[contract.status].title },
        orderDisplayId: displayId,
        status: contract.status,
      },
    },
  ])
}

export const config: SubscriberConfig = { event: Object.keys(contracts) }
