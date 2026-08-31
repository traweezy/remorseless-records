import type { CreateNotificationDTO } from "@medusajs/framework/types"

import {
  readNotificationEmail,
  readNotificationEntityId,
  readNotificationText,
} from "../notifications/contracts"
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
}): CreateNotificationDTO[] => {
  const email = readNotificationEmail(context.email)
  const referenceLabel = readNotificationText(context.referenceLabel, 120)
  const resourceId = readNotificationEntityId(
    context.resourceId,
    context.resourceType
  )
  const customerId =
    context.customerId === null
      ? null
      : readNotificationEntityId(context.customerId, "cus")
  const refundIds = context.refunds.map((refund) =>
    readNotificationEntityId(refund.id, "refund")
  )
  if (
    template !== "refund-issued" ||
    !email ||
    !referenceLabel ||
    !resourceId ||
    (context.customerId !== null && !customerId) ||
    !context.refunds.length ||
    context.refunds.length > 50 ||
    refundIds.some((id) => !id) ||
    new Set(refundIds).size !== refundIds.length
  ) {
    return []
  }

  return context.refunds.flatMap((refund, index) => {
    const formattedAmount = formatCurrencyAmount(
      refund.amount,
      context.currencyCode
    )
    const note =
      refund.note === null || refund.note === undefined || refund.note === ""
        ? null
        : readNotificationText(refund.note, 2_000)
    const refundId = refundIds[index]
    if (
      !formattedAmount ||
      !refundId ||
      (refund.note !== null &&
        refund.note !== undefined &&
        refund.note !== "" &&
        !note)
    ) {
      return []
    }
    const idempotencyKey = `refund-issued:${refundId}`
    return [
      {
        ...emailIdempotencyFields(idempotencyKey),
        channel: "email",
        data: {
          emailOptions: {
            subject: `Refund issued for ${referenceLabel}`,
          },
          formattedAmount,
          note,
          preview: `${formattedAmount} has been refunded.`,
          referenceLabel,
        },
        receiver_id: customerId,
        resource_id: resourceId,
        resource_type: context.resourceType,
        template,
        to: email,
        trigger_type: "payment.refunded",
      },
    ]
  })
}
