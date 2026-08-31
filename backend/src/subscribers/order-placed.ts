import {
  type CreateNotificationDTO,
  type INotificationModuleService,
  type IOrderModuleService,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa"

import {
  createAndVerifyNotifications,
  readNotificationEntityId,
  readOrderNotificationProjection,
} from "../lib/notifications/contracts"
import { emailIdempotencyFields } from "../modules/email-notifications/idempotency"
import { EmailTemplates } from "../modules/email-notifications/templates"

type OrderPlacedEvent = {
  id: string
}

export default async function orderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<OrderPlacedEvent>): Promise<void> {
  const orderId = readNotificationEntityId(data?.id, "order")
  if (!orderId) {
    throw new Error("Order notification event is malformed.")
  }
  const notificationService = container.resolve<INotificationModuleService>(
    Modules.NOTIFICATION
  )
  const orderService = container.resolve<IOrderModuleService>(Modules.ORDER)
  const orderValue: unknown = await orderService.retrieveOrder(orderId, {
    relations: ["items", "summary", "shipping_address"],
  })
  const projection = readOrderNotificationProjection(orderValue, orderId)

  if (!projection) {
    return
  }

  const idempotencyKey = `order-placed:${projection.order.id}`
  const payload: CreateNotificationDTO = {
    ...emailIdempotencyFields(idempotencyKey),
    channel: "email",
    data: {
      emailOptions: {
        subject: "Your order has been placed",
      },
      order: projection.order,
      shippingAddress: projection.shippingAddress,
      preview: "Thank you for your order!",
    },
    receiver_id: projection.customerId,
    resource_id: projection.order.id,
    resource_type: "order",
    template: EmailTemplates.ORDER_PLACED,
    to: projection.email,
    trigger_type: "order.placed",
  }

  await createAndVerifyNotifications(notificationService, [payload])
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
