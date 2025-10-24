import { Modules } from '@medusajs/framework/utils'
import {
  type INotificationModuleService,
  type IOrderModuleService,
  type CreateNotificationDTO,
} from '@medusajs/framework/types'
import { SubscriberArgs, SubscriberConfig } from '@medusajs/medusa'
import { EmailTemplates } from '../modules/email-notifications/templates'

export default async function orderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<any>) {
  const notificationModuleService: INotificationModuleService = container.resolve(Modules.NOTIFICATION)
  const orderModuleService: IOrderModuleService = container.resolve(Modules.ORDER)
  
  const order = await orderModuleService.retrieveOrder(data.id, {
    relations: ['items', 'summary', 'shipping_address'],
  })

  const shippingAddress = order.shipping_address

  if (!order.email || !shippingAddress) {
    return
  }

  try {
    const payload: CreateNotificationDTO = {
      to: order.email,
      channel: 'email',
      template: EmailTemplates.ORDER_PLACED,
      data: {
        emailOptions: {
          replyTo: 'info@example.com',
          subject: 'Your order has been placed',
        },
        order,
        shippingAddress,
        preview: 'Thank you for your order!',
      },
    }

    await notificationModuleService.createNotifications([payload])
  } catch (error) {
    console.error('Error sending order confirmation notification:', error)
  }
}

export const config: SubscriberConfig = {
  event: 'order.placed'
}
