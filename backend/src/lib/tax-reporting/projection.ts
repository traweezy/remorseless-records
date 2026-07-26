import { MathBN } from "@medusajs/framework/utils";

import { parseTaxLineCode } from "../tax-control/context";
import type { TaxReportPeriod } from "./periods";
import type {
  TaxDestinationSummary,
  TaxRecord,
  TaxRecordDestination,
  TaxRecordProvider,
  TaxRecordQuality,
  TaxRefundCreditTiming,
  TaxReportSummary,
} from "./types";

type UnknownRecord = Record<string, unknown>;
type Decimal = ReturnType<typeof MathBN.convert>;

const ZERO = MathBN.convert(0);

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;

const records = (value: unknown): UnknownRecord[] =>
  Array.isArray(value)
    ? value
        .map(asRecord)
        .filter((record): record is UnknownRecord => record !== null)
    : [];

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const decimal = (value: unknown): Decimal => {
  if (value === null || value === undefined || value === "") {
    return MathBN.convert(0);
  }
  try {
    const converted = MathBN.convert(
      value as Parameters<typeof MathBN.convert>[0],
    );
    if (!converted.isFinite()) {
      throw new Error("Non-finite monetary value.");
    }
    return converted;
  } catch {
    throw new Error(
      "Tax projection encountered an invalid monetary value.",
    );
  }
};

const money = (value: Decimal): string => value.toFixed(4);

const decimalField = (
  record: UnknownRecord,
  rawField: string,
  field: string,
): Decimal => decimal(record[rawField] ?? record[field]);

const timestamp = (value: unknown): string | null => {
  const parsed = value instanceof Date ? value : new Date(String(value ?? ""));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const inPeriod = (value: string, period: TaxReportPeriod): boolean =>
  value >= period.startInclusive && value < period.endExclusive;

const unique = <T,>(values: T[]): T[] => [...new Set(values)];

const taxLines = (subject: UnknownRecord): UnknownRecord[] =>
  records(subject.tax_lines);

const subjects = (order: UnknownRecord): UnknownRecord[] => [
  ...records(order.items),
  ...records(order.shipping_methods),
];

const providerIdentity = (
  order: UnknownRecord,
): {
  calculationId: string | null;
  generation: number | null;
  provider: TaxRecordProvider;
} => {
  const lines = subjects(order).flatMap(taxLines);
  if (!lines.length) {
    return {
      calculationId: null,
      generation: null,
      provider: "unknown",
    };
  }

  const controlled = lines
    .map((line) => parseTaxLineCode(line.code))
    .filter((identity): identity is NonNullable<typeof identity> =>
      Boolean(identity),
    );
  if (!controlled.length) {
    const isLegacy = lines.every(
      (line) =>
        text(line.code) === "sales_tax" &&
        text(line.provider_id) === "rate_lookup",
    );
    return {
      calculationId: null,
      generation: null,
      provider: isLegacy ? "legacy" : "unknown",
    };
  }
  if (controlled.length !== lines.length) {
    return {
      calculationId: null,
      generation: null,
      provider: "mixed",
    };
  }

  const providers = unique(controlled.map((identity) => identity.provider));
  const generations = unique(
    controlled.map((identity) => identity.generation),
  );
  const calculationIds = unique(
    controlled.map((identity) => identity.calculationId),
  );
  if (
    providers.length !== 1 ||
    generations.length !== 1 ||
    calculationIds.length !== 1
  ) {
    return {
      calculationId: null,
      generation: null,
      provider: "mixed",
    };
  }

  return {
    calculationId: calculationIds[0] ?? null,
    generation: generations[0] ?? null,
    provider: providers[0]!,
  };
};

const lineJurisdiction = (order: UnknownRecord): UnknownRecord | null => {
  const jurisdictions = subjects(order)
    .flatMap(taxLines)
    .map((line) => asRecord(asRecord(line.data)?.jurisdiction))
    .filter((value): value is UnknownRecord => value !== null);
  const first = jurisdictions[0];
  if (!first) {
    return null;
  }
  const fingerprint = JSON.stringify(first);
  return jurisdictions.every((entry) => JSON.stringify(entry) === fingerprint)
    ? first
    : null;
};

const destinationFrom = (order: UnknownRecord): TaxRecordDestination => {
  const address = asRecord(order.shipping_address);
  const jurisdiction = lineJurisdiction(order);
  return {
    city: text(jurisdiction?.city) ?? text(address?.city),
    countryCode:
      text(jurisdiction?.country_code)?.toUpperCase() ??
      text(address?.country_code)?.toUpperCase() ??
      null,
    county: text(jurisdiction?.county),
    jurisdictionLevel: text(jurisdiction?.level),
    jurisdictionName:
      text(jurisdiction?.name) ??
      text(jurisdiction?.tax_name) ??
      text(jurisdiction?.county) ??
      text(jurisdiction?.city),
    postalCode: text(address?.postal_code),
    stateCode:
      text(jurisdiction?.state)?.toUpperCase() ??
      text(address?.province)?.toUpperCase() ??
      null,
  };
};

const originalAmounts = (
  order: UnknownRecord,
): {
  gross: Decimal;
  tax: Decimal;
  taxable: Decimal;
  total: Decimal;
} => {
  const gross = decimalField(
    order,
    "raw_original_subtotal",
    "original_subtotal",
  );
  const tax = decimalField(
    order,
    "raw_original_tax_total",
    "original_tax_total",
  );
  const total = decimalField(order, "raw_original_total", "original_total");
  const orderSubjects = subjects(order);
  let subjectGross = ZERO;
  let subjectTaxable = ZERO;

  for (const subject of orderSubjects) {
    const amount = decimalField(
      subject,
      "raw_original_subtotal",
      "original_subtotal",
    );
    const rates = taxLines(subject).map((line) => decimal(line.rate));
    subjectGross = MathBN.add(subjectGross, amount);
    if (rates.some((rate) => rate.gt(0))) {
      subjectTaxable = MathBN.add(subjectTaxable, amount);
    }
  }

  const taxable =
    subjectGross.gt(0) && gross.gte(0)
      ? MathBN.mult(gross, MathBN.div(subjectTaxable, subjectGross))
      : tax.gt(0)
        ? gross
        : ZERO;
  return { gross, tax, taxable, total };
};

const effectiveRate = (tax: Decimal, taxable: Decimal): string | null =>
  tax.gt(0) && taxable.gt(0)
    ? MathBN.mult(MathBN.div(tax, taxable), 100).toFixed(6)
    : null;

const qualityFor = ({
  destination,
  isEstimatedRefund,
  provider,
  tax,
}: {
  destination: TaxRecordDestination;
  isEstimatedRefund: boolean;
  provider: TaxRecordProvider;
  tax: Decimal;
}): { issues: string[]; quality: TaxRecordQuality } => {
  const issues: string[] = [];
  let incomplete = false;

  if (
    !destination.countryCode ||
    !destination.stateCode ||
    !destination.postalCode
  ) {
    issues.push("Delivery destination is incomplete.");
    incomplete = true;
  }
  if (tax.gt(0) && provider === "unknown") {
    issues.push("Tax line identity is missing.");
    incomplete = true;
  }
  if (provider === "mixed") {
    issues.push("Tax lines contain mixed provider identities.");
    incomplete = true;
  }
  if (provider === "legacy") {
    issues.push("Legacy tax lines do not include provider-generation evidence.");
  }
  if (provider === "stripe_tax" && !destination.jurisdictionLevel) {
    issues.push(
      "Use the Stripe itemized report to confirm sub-state jurisdiction rows.",
    );
  }
  if (
    provider === "taxrate_io" &&
    tax.gt(0) &&
    !destination.county &&
    !destination.jurisdictionName
  ) {
    issues.push("The TaxRate.io locality breakdown was not preserved.");
  }
  if (isEstimatedRefund) {
    issues.push(
      "The tax portion of this partial refund is proportionally estimated.",
    );
  }

  return {
    issues,
    quality: incomplete ? "incomplete" : issues.length ? "review" : "complete",
  };
};

const payments = (order: UnknownRecord): UnknownRecord[] =>
  records(order.payment_collections).flatMap((collection) =>
    records(collection.payments),
  );

const paidTotal = (order: UnknownRecord): Decimal => {
  const summary = asRecord(order.summary);
  const summaryPaid = decimalField(
    summary ?? {},
    "raw_paid_total",
    "paid_total",
  );
  if (summaryPaid.gt(0)) {
    return summaryPaid;
  }
  return payments(order).reduce(
    (total, payment) =>
      payment.captured_at
        ? MathBN.add(
            total,
            decimalField(payment, "raw_captured_amount", "captured_amount"),
          )
        : total,
    ZERO,
  );
};

const paymentCaptureTimestamp = (order: UnknownRecord): string | null => {
  const timestamps = payments(order)
    .filter((payment) =>
      decimalField(
        payment,
        "raw_captured_amount",
        "captured_amount",
      ).gt(0),
    )
    .map((payment) => timestamp(payment.captured_at))
    .filter((value): value is string => value !== null)
    .sort();
  return timestamps.at(-1) ?? null;
};

const baseRecord = (
  order: UnknownRecord,
): {
  currencyCode: string;
  destination: TaxRecordDestination;
  displayId: number;
  identity: ReturnType<typeof providerIdentity>;
  orderId: string;
} | null => {
  const orderId = text(order.id);
  const displayId = Number(order.display_id);
  if (!orderId || !Number.isSafeInteger(displayId)) {
    return null;
  }
  return {
    currencyCode: text(order.currency_code)?.toLowerCase() ?? "usd",
    destination: destinationFrom(order),
    displayId,
    identity: providerIdentity(order),
    orderId,
  };
};

const saleRecord = (
  order: UnknownRecord,
  period: TaxReportPeriod,
): TaxRecord | null => {
  const base = baseRecord(order);
  const capturedAt = paymentCaptureTimestamp(order);
  const occurredAt = capturedAt ?? timestamp(order.created_at);
  if (!base || !occurredAt || !inPeriod(occurredAt, period)) {
    return null;
  }
  const amounts = originalAmounts(order);
  if (!amounts.total.gt(0)) {
    return null;
  }
  const capturedTotal = paidTotal(order);
  if (!capturedTotal.gt(0)) {
    return null;
  }
  const quality = qualityFor({
    destination: base.destination,
    isEstimatedRefund: false,
    provider: base.identity.provider,
    tax: amounts.tax,
  });
  if (!capturedTotal.eq(amounts.total)) {
    quality.issues.push(
      "Captured payment does not match the original order total.",
    );
    quality.quality = "incomplete";
  }
  if (!capturedAt) {
    quality.issues.push(
      "Payment capture time is missing; the order timestamp was used.",
    );
    if (quality.quality === "complete") {
      quality.quality = "review";
    }
  }
  if (base.currencyCode !== "usd") {
    quality.issues.push("Confirm filing-currency conversion outside USD.");
    if (quality.quality === "complete") {
      quality.quality = "review";
    }
  }

  return {
    currencyCode: base.currencyCode,
    destination: base.destination,
    displayId: base.displayId,
    generation: base.identity.generation,
    grossSales: money(amounts.gross),
    id: `sale:${base.orderId}`,
    issues: quality.issues,
    nontaxableSales: money(MathBN.sub(amounts.gross, amounts.taxable)),
    occurredAt,
    orderId: base.orderId,
    provider: base.identity.provider,
    quality: quality.quality,
    refundCreditTiming: null,
    refundId: null,
    refundTaxMethod: null,
    taxAmount: money(amounts.tax),
    taxableSales: money(amounts.taxable),
    taxCalculationId: base.identity.calculationId,
    taxRatePercent: effectiveRate(amounts.tax, amounts.taxable),
    total: money(amounts.total),
    type: "sale",
  };
};

const refundRecords = (
  order: UnknownRecord,
  period: TaxReportPeriod,
): TaxRecord[] => {
  const base = baseRecord(order);
  if (!base) {
    return [];
  }
  const amounts = originalAmounts(order);
  if (!amounts.total.gt(0)) {
    return [];
  }

  const candidates = payments(order).flatMap((payment) =>
    records(payment.refunds).flatMap((refund) => {
      const refundId = text(refund.id);
      const occurredAt = timestamp(refund.created_at);
      const refundTotal = decimalField(refund, "raw_amount", "amount");
      if (!refundId || !occurredAt || !refundTotal.gt(0)) {
        return [];
      }
      return [{ occurredAt, refundId, refundTotal }];
    }),
  );
  const cumulativeRefundTotal = candidates.reduce(
    (total, candidate) => MathBN.add(total, candidate.refundTotal),
    ZERO,
  );
  const cumulativeRefundExceedsOrder = cumulativeRefundTotal.gt(amounts.total);
  const orderOccurredAt = timestamp(order.created_at);

  return candidates.flatMap(({ occurredAt, refundId, refundTotal }) => {
    if (!inPeriod(occurredAt, period)) {
      return [];
    }
    const ratio = MathBN.div(refundTotal, amounts.total);
    const gross = MathBN.mult(amounts.gross, ratio);
    const tax = MathBN.mult(amounts.tax, ratio);
    const taxable = MathBN.mult(amounts.taxable, ratio);
    const isEstimated = !refundTotal.eq(amounts.total);
    const quality = qualityFor({
      destination: base.destination,
      isEstimatedRefund: isEstimated,
      provider: base.identity.provider,
      tax,
    });
    let refundCreditTiming: TaxRefundCreditTiming;
    if (!orderOccurredAt || occurredAt < orderOccurredAt) {
      refundCreditTiming = "unknown";
      quality.issues.push(
        "The refund cannot be matched to a valid original-sale timestamp.",
      );
      quality.quality = "incomplete";
    } else if (orderOccurredAt < period.startInclusive) {
      refundCreditTiming = "prior_period";
      quality.issues.push(
        "This refund relates to a sale from an earlier filing period; confirm the locality credit and required New York support.",
      );
      if (quality.quality === "complete") {
        quality.quality = "review";
      }
    } else {
      refundCreditTiming = "same_period";
    }
    if (cumulativeRefundExceedsOrder) {
      quality.issues.push("Cumulative refunds exceed the original order total.");
      quality.quality = "incomplete";
    }
    if (base.currencyCode !== "usd") {
      quality.issues.push("Confirm filing-currency conversion outside USD.");
      if (quality.quality === "complete") {
        quality.quality = "review";
      }
    }

    return [
      {
        currencyCode: base.currencyCode,
        destination: base.destination,
        displayId: base.displayId,
        generation: base.identity.generation,
        grossSales: money(gross),
        id: `refund:${refundId}`,
        issues: quality.issues,
        nontaxableSales: money(MathBN.sub(gross, taxable)),
        occurredAt,
        orderId: base.orderId,
        provider: base.identity.provider,
        quality: quality.quality,
        refundCreditTiming,
        refundId,
        refundTaxMethod: isEstimated ? "estimated" : "exact",
        taxAmount: money(tax),
        taxableSales: money(taxable),
        taxCalculationId: base.identity.calculationId,
        taxRatePercent: effectiveRate(tax, taxable),
        total: money(refundTotal),
        type: "refund" as const,
      },
    ];
  });
};

const addMoney = (left: string, right: string): string =>
  money(MathBN.add(decimal(left), decimal(right)));

const subtractMoney = (left: string, right: string): string =>
  money(MathBN.sub(decimal(left), decimal(right)));

export const summarizeTaxRecords = (
  recordsToSummarize: TaxRecord[],
): TaxReportSummary[] => {
  const currencies = unique(
    recordsToSummarize.map((record) => record.currencyCode),
  ).sort();
  const reportingCurrencies = currencies.length ? currencies : ["usd"];

  return reportingCurrencies.map((currencyCode) => {
    const currencyRecords = recordsToSummarize.filter(
      (record) => record.currencyCode === currencyCode,
    );
    const sales = currencyRecords.filter((record) => record.type === "sale");
    const refunds = currencyRecords.filter(
      (record) => record.type === "refund",
    );
    const sum = (values: string[]): string =>
      money(values.reduce((total, value) => MathBN.add(total, value), ZERO));
    const grossSales = sum(sales.map((record) => record.grossSales));
    const refundedSales = sum(refunds.map((record) => record.grossSales));
    const taxCollected = sum(sales.map((record) => record.taxAmount));
    const refundedTax = sum(refunds.map((record) => record.taxAmount));

    return {
      completeRecords: currencyRecords.filter(
        (record) => record.quality === "complete",
      ).length,
      currencyCode,
      grossSales,
      incompleteRecords: currencyRecords.filter(
        (record) => record.quality === "incomplete",
      ).length,
      netSales: subtractMoney(grossSales, refundedSales),
      netTax: subtractMoney(taxCollected, refundedTax),
      nontaxableSales: subtractMoney(
        sum(sales.map((record) => record.nontaxableSales)),
        sum(refunds.map((record) => record.nontaxableSales)),
      ),
      orderCount: new Set(sales.map((record) => record.orderId)).size,
      priorPeriodRefundCount: refunds.filter(
        (record) => record.refundCreditTiming === "prior_period",
      ).length,
      refundCount: refunds.length,
      refundedSales,
      refundedTax,
      reviewRecords: currencyRecords.filter(
        (record) => record.quality === "review",
      ).length,
      samePeriodRefundCount: refunds.filter(
        (record) => record.refundCreditTiming === "same_period",
      ).length,
      taxCollected,
      taxableSales: subtractMoney(
        sum(sales.map((record) => record.taxableSales)),
        sum(refunds.map((record) => record.taxableSales)),
      ),
    };
  });
};

const destinationKey = (record: TaxRecord): string =>
  JSON.stringify([
    record.currencyCode,
    record.destination.countryCode,
    record.destination.stateCode,
    record.destination.county,
    record.destination.city,
    record.destination.postalCode,
    record.destination.jurisdictionLevel,
    record.destination.jurisdictionName,
    record.taxRatePercent,
  ]);

export const summarizeDestinations = (
  recordsToSummarize: TaxRecord[],
): TaxDestinationSummary[] => {
  const grouped = new Map<string, TaxRecord[]>();
  for (const record of recordsToSummarize) {
    const key = destinationKey(record);
    grouped.set(key, [...(grouped.get(key) ?? []), record]);
  }

  return [...grouped.values()]
    .map((group) => {
      const first = group[0]!;
      const sales = group.filter((record) => record.type === "sale");
      const refunds = group.filter((record) => record.type === "refund");
      const sum = (field: keyof TaxRecord, values: TaxRecord[]): string =>
        money(
          values.reduce(
            (total, record) =>
              MathBN.add(total, String(record[field] ?? "0")),
            ZERO,
          ),
        );
      return {
        city: first.destination.city,
        countryCode: first.destination.countryCode,
        county: first.destination.county,
        currencyCode: first.currencyCode,
        grossSales: sum("grossSales", sales),
        jurisdictionLevel: first.destination.jurisdictionLevel,
        jurisdictionName: first.destination.jurisdictionName,
        netSales: subtractMoney(
          sum("grossSales", sales),
          sum("grossSales", refunds),
        ),
        netTax: subtractMoney(
          sum("taxAmount", sales),
          sum("taxAmount", refunds),
        ),
        nontaxableSales: subtractMoney(
          sum("nontaxableSales", sales),
          sum("nontaxableSales", refunds),
        ),
        postalCode: first.destination.postalCode,
        refundedSales: sum("grossSales", refunds),
        refundedTax: sum("taxAmount", refunds),
        stateCode: first.destination.stateCode,
        taxCollected: sum("taxAmount", sales),
        taxableSales: subtractMoney(
          sum("taxableSales", sales),
          sum("taxableSales", refunds),
        ),
        taxRatePercent: first.taxRatePercent,
      };
    })
    .sort((left, right) =>
      [
        left.currencyCode,
        left.countryCode,
        left.stateCode,
        left.jurisdictionName,
        left.city,
        left.postalCode,
      ]
        .map((value) => value ?? "")
        .join(":")
        .localeCompare(
          [
            right.currencyCode,
            right.countryCode,
            right.stateCode,
            right.jurisdictionName,
            right.city,
            right.postalCode,
          ]
            .map((value) => value ?? "")
            .join(":"),
        ),
    );
};

export const projectTaxRecords = ({
  orders,
  period,
}: {
  orders: unknown[];
  period: TaxReportPeriod;
}): TaxRecord[] =>
  orders
    .flatMap((value) => {
      const order = asRecord(value);
      if (!order) {
        return [];
      }
      const sale = saleRecord(order, period);
      return [...(sale ? [sale] : []), ...refundRecords(order, period)];
    })
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));

export const totalWithTax = (summary: TaxDestinationSummary): string =>
  addMoney(summary.grossSales, summary.taxCollected);
