import { MathBN } from "@medusajs/framework/utils";

import type { TaxReportPeriod } from "./periods";
import type {
  TaxDestinationSummary,
  TaxRecord,
  TaxReportSummary,
} from "./types";

const FORMULA_PREFIX = /^[\t\r\n ]*[=+\-@]/;
const DECIMAL_VALUE = /^-?\d+(?:\.\d+)?$/;

const safeText = (value: unknown): string => {
  const text = String(value ?? "");
  return FORMULA_PREFIX.test(text) && !DECIMAL_VALUE.test(text)
    ? `'${text}`
    : text;
};

const cell = (value: unknown): string => {
  const text = safeText(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const rowsToCsv = (rows: unknown[][]): string =>
  `\uFEFF${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;

const signed = (value: string, type: TaxRecord["type"]): string =>
  type === "refund" && Number(value) !== 0 ? `-${value}` : value;

const subtract = (left: string, right: string): string =>
  MathBN.sub(left, right).toFixed(4);

export const taxTransactionsCsv = ({
  generatedAt,
  period,
  records,
  summary,
}: {
  generatedAt: string;
  period: TaxReportPeriod;
  records: TaxRecord[];
  summary: TaxReportSummary;
}): string =>
  rowsToCsv([
    [
      "record_type",
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
      "tax_amount",
      "total_including_tax",
      "record_quality",
      "refund_tax_method",
      "issues",
      "report_period_start",
      "report_period_end_exclusive",
      "report_generated_at",
      "period_net_sales",
      "period_net_tax",
    ],
    ...records.map((record) => [
      record.type,
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
      signed(record.taxAmount, record.type),
      signed(record.total, record.type),
      record.quality,
      record.refundTaxMethod,
      record.issues.join(" | "),
      period.startDate,
      period.endDate,
      generatedAt,
      summary.netSales,
      summary.netTax,
    ]),
  ]);

export const taxDestinationsCsv = ({
  destinations,
  generatedAt,
  period,
  summary,
}: {
  destinations: TaxDestinationSummary[];
  generatedAt: string;
  period: TaxReportPeriod;
  summary: TaxReportSummary;
}): string =>
  rowsToCsv([
    [
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
      "tax_collected",
      "tax_refunded",
      "net_tax",
      "report_period_start",
      "report_period_end_exclusive",
      "report_timezone",
      "report_generated_at",
    ],
    ...destinations.map((destination) => [
      destination.countryCode,
      destination.stateCode,
      destination.county,
      destination.city,
      destination.postalCode,
      destination.jurisdictionName,
      destination.jurisdictionLevel,
      destination.taxRatePercent,
      "usd",
      destination.grossSales,
      destination.refundedSales,
      subtract(destination.grossSales, destination.refundedSales),
      destination.taxableSales,
      destination.nontaxableSales,
      destination.taxCollected,
      destination.refundedTax,
      subtract(destination.taxCollected, destination.refundedTax),
      period.startDate,
      period.endDate,
      period.timeZone,
      generatedAt,
    ]),
    [],
    ["period_summary"],
    ["gross_sales", summary.grossSales],
    ["sales_refunded", summary.refundedSales],
    ["net_sales", summary.netSales],
    ["net_taxable_sales", summary.taxableSales],
    ["net_nontaxable_sales", summary.nontaxableSales],
    ["tax_collected", summary.taxCollected],
    ["tax_refunded", summary.refundedTax],
    ["net_tax", summary.netTax],
  ]);
