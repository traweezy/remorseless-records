import { filingBucketFor, type TaxFilingScope } from "./filing-states"
import type { TaxReportPeriod } from "./periods"
import type {
  TaxDestinationSummary,
  TaxRecord,
  TaxReportSummary,
} from "./types"

const FORMULA_PREFIX = /^[\t\r\n ]*[=+\-@]/
const DECIMAL_VALUE = /^-?\d+(?:\.\d+)?$/

const safeText = (value: unknown): string => {
  const text = String(value ?? "")
  return FORMULA_PREFIX.test(text) && !DECIMAL_VALUE.test(text)
    ? `'${text}`
    : text
}

const cell = (value: unknown): string => {
  const text = safeText(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

const rowsToCsv = (rows: unknown[][]): string =>
  `\uFEFF${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`

const signed = (value: string, type: TaxRecord["type"]): string =>
  type === "refund" && Number(value) !== 0 ? `-${value}` : value

export const taxTransactionsCsv = ({
  filingState,
  generatedAt,
  period,
  records,
  summaries,
}: {
  filingState: TaxFilingScope
  generatedAt: string
  period: TaxReportPeriod
  records: TaxRecord[]
  summaries: TaxReportSummary[]
}): string => {
  const summaryByCurrency = new Map(
    summaries.map((summary) => [summary.currencyCode, summary])
  )
  return rowsToCsv([
    [
      "record_type",
      "collection_mode",
      "filing_state",
      "filing_bucket",
      "transaction_date_utc",
      "report_timezone",
      "order_number",
      "medusa_order_id",
      "medusa_refund_id",
      "provider",
      "provider_generation",
      "tax_calculation_id",
      "country_code",
      "state_code",
      "county",
      "city",
      "postal_code",
      "jurisdiction_name",
      "jurisdiction_level",
      "tax_rate_percent",
      "currency",
      "gross_sales_excluding_tax",
      "taxable_sales",
      "nontaxable_sales",
      "unclassified_sales_pending_review",
      "tax_amount",
      "total_including_tax",
      "record_quality",
      "refund_tax_method",
      "refund_credit_timing",
      "issues",
      "report_period_start",
      "report_period_end_exclusive",
      "report_generated_at",
      "period_net_sales",
      "period_net_tax",
    ],
    ...records.map((record) => {
      const summary = summaryByCurrency.get(record.currencyCode)
      return [
        record.type,
        record.collectionMode,
        filingState,
        filingBucketFor({
          destination: record.destination,
          filingState,
        }),
        record.occurredAt,
        period.timeZone,
        record.displayId,
        record.orderId,
        record.refundId,
        record.provider,
        record.generation,
        record.taxCalculationId,
        record.destination.countryCode,
        record.destination.stateCode,
        record.destination.county,
        record.destination.city,
        record.destination.postalCode,
        record.destination.jurisdictionName,
        record.destination.jurisdictionLevel,
        record.taxRatePercent,
        record.currencyCode,
        signed(record.grossSales, record.type),
        signed(record.taxableSales, record.type),
        signed(record.nontaxableSales, record.type),
        signed(record.unclassifiedSales, record.type),
        signed(record.taxAmount, record.type),
        signed(record.total, record.type),
        record.quality,
        record.refundTaxMethod,
        record.refundCreditTiming,
        record.issues.join(" | "),
        period.startDate,
        period.endDate,
        generatedAt,
        summary?.netSales ?? "",
        summary?.netTax ?? "",
      ]
    }),
  ])
}

export const taxDestinationsCsv = ({
  destinations,
  filingState,
  generatedAt,
  period,
  summaries,
}: {
  destinations: TaxDestinationSummary[]
  filingState: TaxFilingScope
  generatedAt: string
  period: TaxReportPeriod
  summaries: TaxReportSummary[]
}): string =>
  rowsToCsv([
    [
      "filing_state",
      "filing_bucket",
      "country_code",
      "state_code",
      "county",
      "city",
      "postal_code",
      "jurisdiction_name",
      "jurisdiction_level",
      "tax_rate_percent",
      "currency",
      "gross_sales",
      "sales_refunded",
      "net_sales",
      "net_taxable_sales",
      "net_nontaxable_sales",
      "net_unclassified_sales_pending_review",
      "tax_collected",
      "tax_refunded",
      "net_tax",
      "report_period_start",
      "report_period_end_exclusive",
      "report_timezone",
      "report_generated_at",
    ],
    ...destinations.map((destination) => [
      filingState,
      filingBucketFor({ destination, filingState }),
      destination.countryCode,
      destination.stateCode,
      destination.county,
      destination.city,
      destination.postalCode,
      destination.jurisdictionName,
      destination.jurisdictionLevel,
      destination.taxRatePercent,
      destination.currencyCode,
      destination.grossSales,
      destination.refundedSales,
      destination.netSales,
      destination.taxableSales,
      destination.nontaxableSales,
      destination.unclassifiedSales,
      destination.taxCollected,
      destination.refundedTax,
      destination.netTax,
      period.startDate,
      period.endDate,
      period.timeZone,
      generatedAt,
    ]),
    [],
    ["filing_state", filingState],
    ["period_summary"],
    [
      "currency",
      "gross_sales",
      "sales_refunded",
      "net_sales",
      "net_taxable_sales",
      "net_nontaxable_sales",
      "net_unclassified_sales_pending_review",
      "tax_collected",
      "tax_refunded",
      "net_tax",
      "same_period_refunds",
      "prior_period_refunds",
    ],
    ...summaries.map((summary) => [
      summary.currencyCode,
      summary.grossSales,
      summary.refundedSales,
      summary.netSales,
      summary.taxableSales,
      summary.nontaxableSales,
      summary.unclassifiedSales,
      summary.taxCollected,
      summary.refundedTax,
      summary.netTax,
      summary.samePeriodRefundCount,
      summary.priorPeriodRefundCount,
    ]),
  ])
