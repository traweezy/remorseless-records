import * as React from "react"

import { Base } from "./base"
import { Hr, Section, Text } from "./primitives"

export const REFUND_ISSUED = "refund-issued"

export type RefundIssuedTemplateProps = {
  formattedAmount: string
  note?: string | null
  preview?: string
  referenceLabel: string
}

type UnknownRecord = Record<string, unknown>

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null

const nonEmptyText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0

export const isRefundIssuedTemplateData = (
  value: unknown
): value is RefundIssuedTemplateProps => {
  const record = asRecord(value)
  return (
    nonEmptyText(record?.formattedAmount) &&
    nonEmptyText(record?.referenceLabel) &&
    (record.preview === undefined || nonEmptyText(record.preview)) &&
    (record.note === undefined ||
      record.note === null ||
      nonEmptyText(record.note))
  )
}

export const RefundIssuedTemplate = ({
  formattedAmount,
  note,
  preview = `${formattedAmount} has been refunded.`,
  referenceLabel,
}: RefundIssuedTemplateProps): React.ReactElement => (
  <Base preview={preview}>
    <Section>
      <Text
        style={{
          fontSize: "24px",
          fontWeight: "bold",
          margin: "0 0 24px",
          textAlign: "center",
        }}
      >
        Refund issued
      </Text>
      <Text>
        We issued a <strong>{formattedAmount}</strong> refund for{" "}
        {referenceLabel}.
      </Text>
      <Text>
        The refund is going back to the original payment method. Your bank
        controls when the credit appears on your statement.
      </Text>
      {note ? (
        <>
          <Hr />
          <Text style={{ fontWeight: "bold", marginBottom: "8px" }}>
            Note from Remorseless Records
          </Text>
          <Text>{note}</Text>
        </>
      ) : null}
      <Hr />
      <Text style={{ color: "#52525b", fontSize: "14px", marginBottom: 0 }}>
        If the refund is not visible after your bank&apos;s normal processing
        time, reply to this email so we can investigate it without creating a
        duplicate refund.
      </Text>
    </Section>
  </Base>
)

RefundIssuedTemplate.PreviewProps = {
  formattedAmount: "$12.50",
  note: "We refunded the unavailable item.",
  referenceLabel: "order #42",
} satisfies RefundIssuedTemplateProps

export default RefundIssuedTemplate
