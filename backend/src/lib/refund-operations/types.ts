export type RefundCaseStatus = "action_required" | "processing" | "verified"

export type RefundTaxStatus =
  "attention" | "not_applicable" | "pending" | "untracked" | "verified"

export type RefundProvider = "stripe_tax" | "taxrate_io" | "untracked"

export type StripeRefundStatus =
  | "canceled"
  | "failed"
  | "pending"
  | "requires_action"
  | "succeeded"
  | "unknown"

export type RefundCase = {
  caseId: string
  currencyCode: string
  displayId: number | null
  latestRefundAt: string | null
  lastVerifiedAt: string | null
  medusaRefundAmountMinor: number
  medusaRefundCount: number
  nextAction: string
  orderId: string | null
  provider: RefundProvider
  reasonLabels: string[]
  status: RefundCaseStatus
  stripeRefundAmountMinor: number | null
  stripeRefundCount: number | null
  stripeStatuses: StripeRefundStatus[]
  taxStatus: RefundTaxStatus
}

export type RefundOperationsSnapshot = {
  cases: RefundCase[]
  generatedAt: string
  reasonConfiguration: {
    configured: boolean
    count: number
  }
  source: {
    evidenceScanned: number
    ordersScanned: number
    truncated: boolean
    windowDays: number
  }
  summary: {
    actionRequired: number
    amountsByCurrency: Array<{
      amountMinor: number
      currencyCode: string
    }>
    processing: number
    totalCases: number
    verified: number
  }
}
