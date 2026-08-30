import type { TaxQuoteEvidenceStatus } from "../../modules/tax-control/constants"
import {
  readFiniteNumber,
  readNonNegativeSafeInteger,
} from "../provider-boundary/primitives"
import {
  asUnknownRecord as asRecord,
  readRecordArray,
  type UnknownRecord,
} from "../provider-boundary/records"

export type RefundEvidenceRecord = {
  association_status: string | null
  cart_id: string
  collection_mode: "collect" | "disabled"
  currency_code: string
  id: string
  last_verified_at: Date | string | null
  metadata: unknown
  order_id: string | null
  payment_intent_id: string
  provider: "stripe_tax" | "taxrate_io" | null
  status: TaxQuoteEvidenceStatus
}

export type RefundLedgerMismatch = {
  evidence: RefundEvidenceRecord
  medusaRefundAmountMinor: number
  stripeEvidenceAvailable: boolean
  stripeRefundAmountMinor: number
}

const records = (value: unknown, context: string): UnknownRecord[] =>
  readRecordArray(value, { context, optional: true })

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null

const majorToMinor = (value: unknown): number | null => {
  const amount = readFiniteNumber(value)
  if (amount === null || amount < 0) {
    return null
  }
  const minor = Math.round(amount * 100)
  return Number.isSafeInteger(minor) ? minor : null
}

const evidenceRefundMinor = (evidence: RefundEvidenceRecord): number | null => {
  if (evidence.metadata === null || evidence.metadata === undefined) {
    return null
  }
  const metadata = asRecord(evidence.metadata)
  if (!metadata) {
    throw new Error("Refund evidence metadata is malformed.")
  }
  if (!Object.hasOwn(metadata, "refund_amount_minor")) {
    return null
  }
  const amount = readNonNegativeSafeInteger(metadata.refund_amount_minor)
  if (amount === null) {
    throw new Error("Refund evidence amount is malformed.")
  }
  return amount
}

const paymentIntentId = (payment: UnknownRecord): string | null => {
  if (text(payment.provider_id) !== "pp_stripe_stripe") {
    return null
  }
  const id = text(asRecord(payment.data)?.id)
  return id && /^pi_[A-Za-z0-9]+$/.test(id) ? id : null
}

export const buildRefundLedgerMismatches = ({
  evidence,
  paymentRecords,
}: {
  evidence: RefundEvidenceRecord[]
  paymentRecords: unknown[]
}): RefundLedgerMismatch[] => {
  const medusaRefundsByIntent = new Map<string, number>()
  const paymentIntents = new Set<string>()
  for (const record of records(paymentRecords, "Refund ledger payment query")) {
    const singleCollection = asRecord(record?.payment_collection)
    if (
      record.payment_collection !== null &&
      record.payment_collection !== undefined &&
      !singleCollection
    ) {
      throw new Error("Refund ledger payment collection is malformed.")
    }
    const collections = [
      ...records(
        record.payment_collections,
        "Refund ledger payment-collection query"
      ),
      ...(singleCollection ? [singleCollection] : []),
    ]
    for (const collection of collections) {
      for (const payment of records(
        collection.payments,
        "Refund ledger payment query"
      )) {
        if (text(payment.provider_id) !== "pp_stripe_stripe") {
          continue
        }
        const intentId = paymentIntentId(payment)
        if (!intentId) {
          throw new Error("Refund ledger PaymentIntent identity is malformed.")
        }
        if (paymentIntents.has(intentId)) {
          throw new Error("Refund ledger PaymentIntent identity is duplicated.")
        }
        paymentIntents.add(intentId)
        const refunded = records(
          payment.refunds,
          "Refund ledger refund query"
        ).reduce((total, refund) => {
          const amount = majorToMinor(refund.amount)
          if (amount === null || !Number.isSafeInteger(total + amount)) {
            throw new Error("Refund ledger amount is malformed.")
          }
          return total + amount
        }, 0)
        medusaRefundsByIntent.set(intentId, refunded)
      }
    }
  }

  const evidenceIntents = new Set<string>()
  return evidence.flatMap((record) => {
    if (
      !/^pi_[A-Za-z0-9]+$/.test(record.payment_intent_id) ||
      evidenceIntents.has(record.payment_intent_id)
    ) {
      throw new Error("Refund evidence PaymentIntent identity is malformed.")
    }
    evidenceIntents.add(record.payment_intent_id)
    const stripeRefundAmountMinor = evidenceRefundMinor(record)
    const medusaRefundAmountMinor =
      medusaRefundsByIntent.get(record.payment_intent_id) ?? 0
    if (stripeRefundAmountMinor === null && medusaRefundAmountMinor === 0) {
      return []
    }
    const comparableStripeAmount = stripeRefundAmountMinor ?? 0
    return medusaRefundAmountMinor === comparableStripeAmount
      ? []
      : [
          {
            evidence: record,
            medusaRefundAmountMinor,
            stripeEvidenceAvailable: stripeRefundAmountMinor !== null,
            stripeRefundAmountMinor: comparableStripeAmount,
          },
        ]
  })
}
