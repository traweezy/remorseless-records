import type { ReactElement } from "react"

import { Base } from "./base"
import { Hr, Section, Text } from "./primitives"

export const FULFILLMENT_STATUS = "fulfillment-status"
export type FulfillmentStatus = "prepared" | "shipped" | "delivered"

export const FULFILLMENT_COPY = {
  prepared: {
    title: "Your items are prepared",
    message: "Items from your order are prepared for dispatch.",
  },
  shipped: {
    title: "Your shipment is on its way",
    message: "A shipment from your order has been dispatched.",
  },
  delivered: {
    title: "Your shipment was delivered",
    message: "A shipment from your order has been marked as delivered.",
  },
} as const

export type FulfillmentStatusTemplateProps = {
  orderDisplayId: number
  status: FulfillmentStatus
}

export const isFulfillmentStatusTemplateData = (
  value: unknown
): value is FulfillmentStatusTemplateProps => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.orderDisplayId === "number" &&
    Number.isSafeInteger(record.orderDisplayId) &&
    record.orderDisplayId > 0 &&
    (record.status === "prepared" ||
      record.status === "shipped" ||
      record.status === "delivered") &&
    Object.keys(record).every((key) =>
      ["orderDisplayId", "status", "emailOptions"].includes(key)
    )
  )
}

export const FulfillmentStatusTemplate = ({
  orderDisplayId,
  status,
}: FulfillmentStatusTemplateProps): ReactElement => {
  const { title, message } = FULFILLMENT_COPY[status]
  return (
    <Base preview={`${title} — order #${orderDisplayId}`} title={title}>
      <Section>
        <h1 style={{ fontSize: "24px", margin: "0 0 24px", color: "#18181b" }}>
          {title}
        </h1>
        <Text style={{ color: "#18181b" }}>
          <strong>Order #{orderDisplayId}</strong>
        </Text>
        <Text style={{ color: "#18181b" }}>{message}</Text>
        <Text style={{ color: "#18181b" }}>
          Orders may arrive in separate shipments. This update applies to one
          shipment from your order.
        </Text>
        <Hr />
        <Text style={{ color: "#52525b", fontSize: "14px", marginBottom: 0 }}>
          If you need help with this shipment, reply to this email and include
          your order number.
        </Text>
      </Section>
    </Base>
  )
}

FulfillmentStatusTemplate.PreviewProps = {
  orderDisplayId: 42,
  status: "shipped",
} satisfies FulfillmentStatusTemplateProps

export default FulfillmentStatusTemplate
