import {
  type CreateNotificationDTO,
  type INotificationModuleService,
  type IOrderModuleService,
} from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import type {
  SubscriberArgs,
  SubscriberConfig,
} from "@medusajs/medusa";

import { emailIdempotencyFields } from "../modules/email-notifications/idempotency";
import { EmailTemplates } from "../modules/email-notifications/templates";

type OrderPlacedEvent = {
  id: string;
};

export default async function orderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<OrderPlacedEvent>): Promise<void> {
  const notificationService =
    container.resolve<INotificationModuleService>(Modules.NOTIFICATION);
  const orderService =
    container.resolve<IOrderModuleService>(Modules.ORDER);
  const order = await orderService.retrieveOrder(data.id, {
    relations: ["items", "summary", "shipping_address"],
  });
  const shippingAddress = order.shipping_address;

  if (!order.email || !shippingAddress) {
    return;
  }

  const idempotencyKey = `order-placed:${order.id}`;
  const payload: CreateNotificationDTO = {
    ...emailIdempotencyFields(idempotencyKey),
    channel: "email",
    data: {
      emailOptions: {
        subject: "Your order has been placed",
      },
      order,
      shippingAddress,
      preview: "Thank you for your order!",
    },
    receiver_id: order.customer_id ?? null,
    resource_id: order.id,
    resource_type: "order",
    template: EmailTemplates.ORDER_PLACED,
    to: order.email,
    trigger_type: "order.placed",
  };

  await notificationService.createNotifications([payload]);
}

export const config: SubscriberConfig = {
  event: "order.placed",
};
