import type { ReactElement } from "react"

import { Base } from "./base"
import { Hr, Section, Text } from "./primitives"

export const AFTER_SALES_STATUS = "after-sales-status"
export const AFTER_SALES_COPY = {
  "return-requested": {
    title: "Your return request is confirmed",
    message: "A return request for your order has been confirmed.",
  },
  "return-received": {
    title: "Your return was received",
    message:
      "All items in one return from your order have been marked as received.",
  },
  "claim-confirmed": {
    title: "Your claim is confirmed",
    message: "A claim for your order has been confirmed.",
  },
  "exchange-confirmed": {
    title: "Your exchange is confirmed",
    message: "An exchange for your order has been confirmed.",
  },
} as const
export type AfterSalesStatus = keyof typeof AFTER_SALES_COPY
export type AfterSalesStatusTemplateProps = {
  orderDisplayId: number
  status: AfterSalesStatus
}

export const isAfterSalesStatusTemplateData = (
  value: unknown
): value is AfterSalesStatusTemplateProps => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.orderDisplayId === "number" &&
    Number.isSafeInteger(record.orderDisplayId) &&
    record.orderDisplayId > 0 &&
    typeof record.status === "string" &&
    Object.hasOwn(AFTER_SALES_COPY, record.status) &&
    Object.keys(record).every((key) =>
      ["orderDisplayId", "status", "emailOptions"].includes(key)
    )
  )
}

export const AfterSalesStatusTemplate = ({
  orderDisplayId,
  status,
}: AfterSalesStatusTemplateProps): ReactElement => {
  const { title, message } = AFTER_SALES_COPY[status]
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
          Any refund or replacement shipment will have a separate update.
        </Text>
        <Hr />
        <Text style={{ color: "#52525b", fontSize: "14px", marginBottom: 0 }}>
          If you need help, reply to this email and include your order number.
        </Text>
      </Section>
    </Base>
  )
}

AfterSalesStatusTemplate.PreviewProps = {
  orderDisplayId: 42,
  status: "return-requested",
} satisfies AfterSalesStatusTemplateProps

export default AfterSalesStatusTemplate
