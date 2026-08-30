import type { CreateNotificationDTO } from "@medusajs/framework/types"

import { formatCurrencyAmount } from "../../modules/email-notifications/currency"
import { emailIdempotencyFields } from "../../modules/email-notifications/idempotency"

type RefundNotificationRefund = {
  amount: unknown
  id: string
  note?: string | null
}

export type RefundNotificationContext = {
  currencyCode: string
  customerId: string | null
  email: string
  referenceLabel: string
  refunds: RefundNotificationRefund[]
  resourceId: string
  resourceType: "cart" | "order"
}

export const buildRefundNotificationPayloads = ({
  context,
  template,
}: {
  context: RefundNotificationContext
  template: string
}): CreateNotificationDTO[] =>
  context.refunds.flatMap((refund) => {
    const formattedAmount = formatCurrencyAmount(
      refund.amount,
      context.currencyCode
    )
    if (!formattedAmount || !refund.id.trim() || !context.email.trim()) {
      return []
    }
    const idempotencyKey = `refund-issued:${refund.id}`
    return [
      {
        ...emailIdempotencyFields(idempotencyKey),
        channel: "email",
        data: {
          emailOptions: {
            subject: `Refund issued for ${context.referenceLabel}`,
          },
          formattedAmount,
          note: refund.note?.trim() || null,
          preview: `${formattedAmount} has been refunded.`,
          referenceLabel: context.referenceLabel,
        },
        receiver_id: context.customerId,
        resource_id: context.resourceId,
        resource_type: context.resourceType,
        template,
        to: context.email,
        trigger_type: "payment.refunded",
      },
    ]
  })
