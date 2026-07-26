import type { CreateNotificationDTO } from "@medusajs/framework/types";

type RefundNotificationRefund = {
  amount: unknown;
  id: string;
  note?: string | null;
};

export type RefundNotificationContext = {
  currencyCode: string;
  customerId: string | null;
  email: string;
  referenceLabel: string;
  refunds: RefundNotificationRefund[];
  resourceId: string;
  resourceType: "cart" | "order";
};

const numericAmount = (value: unknown): number | null => {
  const record =
    value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  const amount = Number(record?.value ?? value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
};

const formatAmount = (amount: unknown, currencyCode: string): string | null => {
  const numeric = numericAmount(amount);
  if (numeric === null || !/^[a-z]{3}$/i.test(currencyCode)) {
    return null;
  }
  try {
    return new Intl.NumberFormat("en-US", {
      currency: currencyCode.toUpperCase(),
      style: "currency",
    }).format(numeric);
  } catch {
    return null;
  }
};

export const buildRefundNotificationPayloads = ({
  context,
  template,
}: {
  context: RefundNotificationContext;
  template: string;
}): CreateNotificationDTO[] =>
  context.refunds.flatMap((refund) => {
    const formattedAmount = formatAmount(
      refund.amount,
      context.currencyCode,
    );
    if (!formattedAmount || !refund.id.trim() || !context.email.trim()) {
      return [];
    }
    return [
      {
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
        idempotency_key: `refund-issued:${refund.id}`,
        receiver_id: context.customerId,
        resource_id: context.resourceId,
        resource_type: context.resourceType,
        template,
        to: context.email,
        trigger_type: "payment.refunded",
      },
    ];
  });
