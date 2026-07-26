export type TaxRecordProvider =
  | "legacy"
  | "mixed"
  | "stripe_tax"
  | "taxrate_io"
  | "unknown";

export type TaxRecordQuality = "complete" | "incomplete" | "review";
export type TaxRecordType = "refund" | "sale";

export type TaxRecordDestination = {
  city: string | null;
  countryCode: string | null;
  county: string | null;
  jurisdictionLevel: string | null;
  jurisdictionName: string | null;
  postalCode: string | null;
  stateCode: string | null;
};

export type TaxRecord = {
  currencyCode: string;
  destination: TaxRecordDestination;
  displayId: number;
  generation: number | null;
  grossSales: string;
  id: string;
  issues: string[];
  nontaxableSales: string;
  occurredAt: string;
  orderId: string;
  provider: TaxRecordProvider;
  quality: TaxRecordQuality;
  refundId: string | null;
  refundTaxMethod: "estimated" | "exact" | null;
  taxAmount: string;
  taxableSales: string;
  taxCalculationId: string | null;
  taxRatePercent: string | null;
  total: string;
  type: TaxRecordType;
};

export type TaxDestinationSummary = {
  city: string | null;
  countryCode: string | null;
  county: string | null;
  grossSales: string;
  jurisdictionLevel: string | null;
  jurisdictionName: string | null;
  nontaxableSales: string;
  postalCode: string | null;
  refundedSales: string;
  refundedTax: string;
  stateCode: string | null;
  taxCollected: string;
  taxRatePercent: string | null;
  taxableSales: string;
};

export type TaxReportSummary = {
  completeRecords: number;
  grossSales: string;
  incompleteRecords: number;
  netSales: string;
  netTax: string;
  nontaxableSales: string;
  orderCount: number;
  refundCount: number;
  refundedSales: string;
  refundedTax: string;
  reviewRecords: number;
  taxCollected: string;
  taxableSales: string;
};
