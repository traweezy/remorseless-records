export type TaxRecordProvider =
  | "legacy"
  | "mixed"
  | "not_applicable"
  | "stripe_tax"
  | "taxrate_io"
  | "unknown";

export type TaxRecordQuality = "complete" | "incomplete" | "review";
export type TaxRecordCollectionMode = "collect" | "disabled" | "unknown";
export type TaxRecordType = "refund" | "sale";
export type TaxRefundCreditTiming = "prior_period" | "same_period" | "unknown";

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
  collectionMode: TaxRecordCollectionMode;
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
  refundCreditTiming: TaxRefundCreditTiming | null;
  refundTaxMethod: "estimated" | "exact" | null;
  taxAmount: string;
  taxableSales: string;
  taxCalculationId: string | null;
  taxRatePercent: string | null;
  total: string;
  type: TaxRecordType;
  unclassifiedSales: string;
};

export type TaxDestinationSummary = {
  city: string | null;
  countryCode: string | null;
  county: string | null;
  currencyCode: string;
  grossSales: string;
  jurisdictionLevel: string | null;
  jurisdictionName: string | null;
  netSales: string;
  netTax: string;
  nontaxableSales: string;
  postalCode: string | null;
  refundedSales: string;
  refundedTax: string;
  stateCode: string | null;
  taxCollected: string;
  taxRatePercent: string | null;
  taxableSales: string;
  unclassifiedSales: string;
};

export type TaxReportSummary = {
  completeRecords: number;
  currencyCode: string;
  disabledRecordCount: number;
  grossSales: string;
  incompleteRecords: number;
  netSales: string;
  netTax: string;
  nontaxableSales: string;
  orderCount: number;
  priorPeriodRefundCount: number;
  refundCount: number;
  refundedSales: string;
  refundedTax: string;
  reviewRecords: number;
  samePeriodRefundCount: number;
  taxCollected: string;
  taxableSales: string;
  unclassifiedSales: string;
};
