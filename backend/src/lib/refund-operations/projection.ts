import type {
  RefundCase,
  RefundCaseStatus,
  RefundOperationsSnapshot,
  RefundProvider,
  RefundTaxStatus,
  StripeRefundStatus,
} from "./types"

import {
  asUnknownRecord as asRecord,
  readRecordArray,
  type UnknownRecord,
} from "../provider-boundary/records"
import {
  readFiniteNumber,
  readIsoTimestamp,
  readNonNegativeSafeInteger,
} from "../provider-boundary/primitives"

const records = (value: unknown): UnknownRecord[] =>
  readRecordArray(value, {
    context: "Refund operations projection relationship",
    optional: true,
  })

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

const refundAmountMinor = (refund: UnknownRecord): number => {
  const amount = majorToMinor(refund.raw_amount ?? refund.amount)
  if (amount === null) {
    throw new Error(
      "Refund operations projection encountered invalid monetary data."
    )
  }
  return amount
}

const latestTimestamp = (values: Array<string | null>): string | null =>
  values
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left))[0] ?? null

const paymentIntentIdFrom = (payment: UnknownRecord): string | null => {
  if (text(payment.provider_id) !== "pp_stripe_stripe") {
    return null
  }
  const id = text(asRecord(payment.data)?.id)
  return id && /^pi_[A-Za-z0-9]+$/.test(id) ? id : null
}

const providerFrom = (evidence: UnknownRecord | null): RefundProvider => {
  if (
    text(evidence?.collection_mode) === "disabled" &&
    !text(evidence?.provider)
  ) {
    return "disabled"
  }
  const provider = text(evidence?.provider)
  return provider === "stripe_tax" || provider === "taxrate_io"
    ? provider
    : "untracked"
}

const stripeStatusesFrom = (metadata: UnknownRecord | null) => {
  const allowed = new Set<StripeRefundStatus>([
    "canceled",
    "failed",
    "pending",
    "requires_action",
    "succeeded",
  ])
  return records(metadata?.stripe_refund_statuses).map((entry) => {
    const status = text(entry.status) as StripeRefundStatus | null
    return status && allowed.has(status) ? status : "unknown"
  })
}

const associationStatusFrom = (evidence: UnknownRecord | null): string =>
  text(evidence?.association_status)?.toLowerCase() ?? ""

const taxStatusFrom = ({
  associationStatus,
  evidence,
  metadata,
  provider,
  stripeStatuses,
}: {
  associationStatus: string
  evidence: UnknownRecord | null
  metadata: UnknownRecord | null
  provider: RefundProvider
  stripeStatuses: StripeRefundStatus[]
}): RefundTaxStatus => {
  if (provider === "disabled") {
    return "not_collected"
  }
  if (provider === "taxrate_io") {
    return "not_applicable"
  }
  if (provider === "untracked") {
    return "untracked"
  }
  if (
    associationStatus.includes("refund_failed:") ||
    associationStatus.includes("refund_list_truncated") ||
    associationStatus.startsWith("errored:") ||
    text(evidence?.status) === "association_failed"
  ) {
    return "attention"
  }

  const missingSources = Array.isArray(metadata?.refund_tax_missing_sources)
    ? metadata.refund_tax_missing_sources.length
    : 0
  if (associationStatus === "refund_pending" || missingSources > 0) {
    return "pending"
  }

  const expectedReversals = stripeStatuses.filter(
    (status) => status !== "failed" && status !== "canceled"
  ).length
  const reversalIds = Array.isArray(metadata?.refund_tax_transaction_ids)
    ? metadata.refund_tax_transaction_ids.length
    : 0
  return expectedReversals > 0 && reversalIds >= expectedReversals
    ? "verified"
    : "pending"
}

const caseStatusFrom = ({
  associationStatus,
  medusaRefundAmountMinor,
  stripeRefundAmountMinor,
  stripeStatuses,
  taxStatus,
  disputed,
}: {
  associationStatus: string
  medusaRefundAmountMinor: number
  stripeRefundAmountMinor: number | null
  stripeStatuses: StripeRefundStatus[]
  taxStatus: RefundTaxStatus
  disputed: boolean
}): RefundCaseStatus => {
  const failed = stripeStatuses.some(
    (status) => status === "failed" || status === "canceled"
  )
  const amountMismatch =
    stripeRefundAmountMinor !== null &&
    medusaRefundAmountMinor !== stripeRefundAmountMinor
  if (
    failed ||
    disputed ||
    amountMismatch ||
    taxStatus === "attention" ||
    associationStatus.includes("refund_failed:") ||
    associationStatus.includes("refund_list_truncated")
  ) {
    return "action_required"
  }
  if (
    stripeRefundAmountMinor === null ||
    stripeStatuses.length === 0 ||
    stripeStatuses.some(
      (status) =>
        status === "pending" ||
        status === "requires_action" ||
        status === "unknown"
    ) ||
    taxStatus === "pending" ||
    taxStatus === "untracked"
  ) {
    return "processing"
  }
  return "verified"
}

const nextActionFrom = ({
  associationStatus,
  medusaRefundAmountMinor,
  status,
  stripeRefundAmountMinor,
  stripeStatuses,
  taxStatus,
  disputed,
}: {
  associationStatus: string
  medusaRefundAmountMinor: number
  status: RefundCaseStatus
  stripeRefundAmountMinor: number | null
  stripeStatuses: StripeRefundStatus[]
  taxStatus: RefundTaxStatus
  disputed: boolean
}): string => {
  if (disputed) {
    return "Pause additional refunds. Reconcile the dispute and existing refund first to avoid reimbursing the customer twice."
  }
  if (
    stripeStatuses.some(
      (stripeStatus) => stripeStatus === "failed" || stripeStatus === "canceled"
    ) ||
    associationStatus.includes("refund_failed:")
  ) {
    return "Open the order and its Stripe payment, confirm the failure reason, then arrange an approved alternative refund without retrying blindly."
  }
  if (associationStatus.includes("refund_list_truncated")) {
    return "The Stripe refund audit exceeded its safe window. Review the payment in Stripe and reconcile every refund before issuing another."
  }
  if (
    stripeRefundAmountMinor !== null &&
    stripeRefundAmountMinor > medusaRefundAmountMinor
  ) {
    return "Do not refund again. Stripe reports more refunded than Medusa; document the direct Stripe refund and reconcile the order ledger."
  }
  if (
    stripeRefundAmountMinor !== null &&
    medusaRefundAmountMinor > stripeRefundAmountMinor
  ) {
    return "Do not retry yet. Medusa records more refunded than Stripe; inspect the provider status and wait for a final failure or success."
  }
  if (taxStatus === "attention") {
    return "The payment refund needs tax review. Verify the Stripe Tax reversal before closing this case."
  }
  if (taxStatus === "pending") {
    return "The refund is recorded; allow the automatic verification job to confirm its tax reversal before closing the case."
  }
  if (status === "processing") {
    return "Wait for Stripe and the automatic verification job to reach a final state. Investigate only if it remains here after the next hourly check."
  }
  return "No action is required. Medusa, Stripe, and the applicable tax evidence agree."
}

const evidenceByIntent = (evidence: unknown[]): Map<string, UnknownRecord> =>
  new Map(
    readRecordArray(evidence, {
      context: "Refund operations evidence query",
    }).flatMap((record) => {
      const intentId = text(record?.payment_intent_id)
      return intentId ? [[intentId, record] as const] : []
    })
  )

const evidenceHasRefundSignal = (evidence: UnknownRecord): boolean => {
  const metadata = asRecord(evidence.metadata)
  const associationStatus = associationStatusFrom(evidence)
  return (
    (readNonNegativeSafeInteger(metadata?.refund_amount_minor) ?? 0) > 0 ||
    (readNonNegativeSafeInteger(metadata?.stripe_refund_count) ?? 0) > 0 ||
    associationStatus.includes("refund_") ||
    text(evidence.status) === "partially_refunded" ||
    text(evidence.status) === "refunded" ||
    text(evidence.status) === "disputed"
  )
}

const unique = (values: Array<string | null>): string[] => [
  ...new Set(values.filter((value): value is string => Boolean(value))),
]

export const projectRefundCases = ({
  evidence,
  orders,
}: {
  evidence: unknown[]
  orders: unknown[]
}): RefundCase[] => {
  const evidenceMap = evidenceByIntent(evidence)
  const matchedPaymentIntents = new Set<string>()
  const cases: RefundCase[] = []

  for (const order of readRecordArray(orders, {
    context: "Refund operations order query",
  })) {
    const orderId = text(order.id)
    const displayId = readNonNegativeSafeInteger(order.display_id)
    for (const collection of records(order.payment_collections)) {
      for (const payment of records(collection.payments)) {
        const paymentIntentId = paymentIntentIdFrom(payment)
        const evidenceRecord = paymentIntentId
          ? (evidenceMap.get(paymentIntentId) ?? null)
          : null
        if (paymentIntentId) {
          matchedPaymentIntents.add(paymentIntentId)
        }
        const metadata = asRecord(evidenceRecord?.metadata)
        const refunds = records(payment.refunds)
        const medusaRefundAmountMinor = refunds.reduce(
          (total, refund) => total + refundAmountMinor(refund),
          0
        )
        const stripeRefundAmountMinor = readNonNegativeSafeInteger(
          metadata?.refund_amount_minor
        )
        const stripeRefundCount =
          readNonNegativeSafeInteger(metadata?.stripe_refund_count) ??
          (Array.isArray(metadata?.stripe_refund_statuses)
            ? metadata.stripe_refund_statuses.length
            : null)
        const associationStatus = associationStatusFrom(evidenceRecord)
        const disputed =
          text(evidenceRecord?.status) === "disputed" ||
          metadata?.disputed === true
        const hasRefundSignal =
          refunds.length > 0 ||
          (stripeRefundAmountMinor ?? 0) > 0 ||
          (stripeRefundCount ?? 0) > 0 ||
          associationStatus.includes("refund_")
        if (!hasRefundSignal) {
          continue
        }

        const stripeStatuses = stripeStatusesFrom(metadata)
        const provider = providerFrom(evidenceRecord)
        const taxStatus = taxStatusFrom({
          associationStatus,
          evidence: evidenceRecord,
          metadata,
          provider,
          stripeStatuses,
        })
        const status = caseStatusFrom({
          associationStatus,
          disputed,
          medusaRefundAmountMinor,
          stripeRefundAmountMinor,
          stripeStatuses,
          taxStatus,
        })
        const currencyCode =
          text(payment.currency_code)?.toLowerCase() ??
          text(evidenceRecord?.currency_code)?.toLowerCase() ??
          text(order.currency_code)?.toLowerCase() ??
          "usd"

        cases.push({
          caseId:
            text(evidenceRecord?.id) ??
            `${orderId ?? "order-unknown"}:${text(payment.id) ?? paymentIntentId ?? "payment-unknown"}`,
          currencyCode,
          displayId,
          latestRefundAt: latestTimestamp([
            ...refunds.map((refund) => readIsoTimestamp(refund.created_at)),
            (stripeRefundCount ?? 0) > 0
              ? readIsoTimestamp(evidenceRecord?.last_verified_at)
              : null,
          ]),
          lastVerifiedAt: readIsoTimestamp(evidenceRecord?.last_verified_at),
          medusaRefundAmountMinor,
          medusaRefundCount: refunds.length,
          nextAction: nextActionFrom({
            associationStatus,
            disputed,
            medusaRefundAmountMinor,
            status,
            stripeRefundAmountMinor,
            stripeStatuses,
            taxStatus,
          }),
          orderId,
          provider,
          reasonLabels: unique(
            refunds.map(
              (refund) =>
                text(asRecord(refund.refund_reason)?.label) ??
                text(refund.refund_reason_id)
            )
          ),
          status,
          stripeRefundAmountMinor,
          stripeRefundCount,
          stripeStatuses,
          taxStatus,
        })
      }
    }
  }

  for (const [paymentIntentId, evidenceRecord] of evidenceMap) {
    if (
      matchedPaymentIntents.has(paymentIntentId) ||
      !evidenceHasRefundSignal(evidenceRecord)
    ) {
      continue
    }
    const metadata = asRecord(evidenceRecord.metadata)
    const stripeRefundAmountMinor =
      readNonNegativeSafeInteger(metadata?.refund_amount_minor) ?? 0
    const stripeRefundCount =
      readNonNegativeSafeInteger(metadata?.stripe_refund_count) ??
      (Array.isArray(metadata?.stripe_refund_statuses)
        ? metadata.stripe_refund_statuses.length
        : 0)
    const stripeStatuses = stripeStatusesFrom(metadata)
    const provider = providerFrom(evidenceRecord)
    const associationStatus = associationStatusFrom(evidenceRecord)
    const disputed =
      text(evidenceRecord.status) === "disputed" || metadata?.disputed === true
    const taxStatus = taxStatusFrom({
      associationStatus,
      evidence: evidenceRecord,
      metadata,
      provider,
      stripeStatuses,
    })
    const status = caseStatusFrom({
      associationStatus,
      disputed,
      medusaRefundAmountMinor: 0,
      stripeRefundAmountMinor,
      stripeStatuses,
      taxStatus,
    })
    cases.push({
      caseId: text(evidenceRecord.id) ?? `checkout:${paymentIntentId}`,
      currencyCode: text(evidenceRecord.currency_code)?.toLowerCase() ?? "usd",
      displayId: null,
      latestRefundAt:
        stripeRefundCount > 0
          ? readIsoTimestamp(evidenceRecord.last_verified_at)
          : null,
      lastVerifiedAt: readIsoTimestamp(evidenceRecord.last_verified_at),
      medusaRefundAmountMinor: 0,
      medusaRefundCount: 0,
      nextAction: nextActionFrom({
        associationStatus,
        disputed,
        medusaRefundAmountMinor: 0,
        status,
        stripeRefundAmountMinor,
        stripeStatuses,
        taxStatus,
      }),
      orderId: text(evidenceRecord.order_id),
      provider,
      reasonLabels: [],
      status,
      stripeRefundAmountMinor,
      stripeRefundCount,
      stripeStatuses,
      taxStatus,
    })
  }

  return cases.sort((left, right) =>
    (right.latestRefundAt ?? right.lastVerifiedAt ?? "").localeCompare(
      left.latestRefundAt ?? left.lastVerifiedAt ?? ""
    )
  )
}

export const summarizeRefundCases = (
  cases: RefundCase[]
): RefundOperationsSnapshot["summary"] => {
  const amounts = new Map<string, number>()
  for (const refundCase of cases) {
    amounts.set(
      refundCase.currencyCode,
      (amounts.get(refundCase.currencyCode) ?? 0) +
        refundCase.medusaRefundAmountMinor
    )
  }
  return {
    actionRequired: cases.filter(
      (refundCase) => refundCase.status === "action_required"
    ).length,
    amountsByCurrency: [...amounts.entries()]
      .map(([currencyCode, amountMinor]) => ({ amountMinor, currencyCode }))
      .sort((left, right) =>
        left.currencyCode.localeCompare(right.currencyCode)
      ),
    processing: cases.filter((refundCase) => refundCase.status === "processing")
      .length,
    totalCases: cases.length,
    verified: cases.filter((refundCase) => refundCase.status === "verified")
      .length,
  }
}
