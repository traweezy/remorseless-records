import type { TaxQuoteEvidenceStatus } from "../../modules/tax-control/constants";

type UnknownRecord = Record<string, unknown>;

export type RefundEvidenceRecord = {
  association_status: string | null;
  cart_id: string;
  collection_mode: "collect" | "disabled";
  currency_code: string;
  id: string;
  last_verified_at: Date | string | null;
  metadata: unknown;
  order_id: string | null;
  payment_intent_id: string;
  provider: "stripe_tax" | "taxrate_io" | null;
  status: TaxQuoteEvidenceStatus;
};

export type RefundLedgerMismatch = {
  evidence: RefundEvidenceRecord;
  medusaRefundAmountMinor: number;
  stripeEvidenceAvailable: boolean;
  stripeRefundAmountMinor: number;
};

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" ? (value as UnknownRecord) : null;

const records = (value: unknown): UnknownRecord[] =>
  Array.isArray(value)
    ? value
        .map(asRecord)
        .filter((record): record is UnknownRecord => record !== null)
    : [];

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const majorToMinor = (value: unknown): number | null => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }
  const minor = Math.round(amount * 100);
  return Number.isSafeInteger(minor) ? minor : null;
};

const evidenceRefundMinor = (evidence: RefundEvidenceRecord): number | null => {
  const metadata = asRecord(evidence.metadata);
  const amount = Number(metadata?.refund_amount_minor);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
};

const paymentIntentId = (payment: UnknownRecord): string | null => {
  if (text(payment.provider_id) !== "pp_stripe_stripe") {
    return null;
  }
  const id = text(asRecord(payment.data)?.id);
  return id && /^pi_[A-Za-z0-9]+$/.test(id) ? id : null;
};

export const buildRefundLedgerMismatches = ({
  evidence,
  paymentRecords,
}: {
  evidence: RefundEvidenceRecord[];
  paymentRecords: unknown[];
}): RefundLedgerMismatch[] => {
  const medusaRefundsByIntent = new Map<string, number>();
  for (const recordValue of paymentRecords) {
    const record = asRecord(recordValue);
    const singleCollection = asRecord(record?.payment_collection);
    const collections = [
      ...records(record?.payment_collections),
      ...(singleCollection ? [singleCollection] : []),
    ];
    for (const collection of collections) {
      for (const payment of records(collection.payments)) {
        const intentId = paymentIntentId(payment);
        if (!intentId) {
          continue;
        }
        const refunded = records(payment.refunds).reduce((total, refund) => {
          const amount = majorToMinor(refund.amount);
          return amount === null ? total : total + amount;
        }, 0);
        medusaRefundsByIntent.set(
          intentId,
          (medusaRefundsByIntent.get(intentId) ?? 0) + refunded,
        );
      }
    }
  }

  return evidence.flatMap((record) => {
    const stripeRefundAmountMinor = evidenceRefundMinor(record);
    const medusaRefundAmountMinor =
      medusaRefundsByIntent.get(record.payment_intent_id) ?? 0;
    if (stripeRefundAmountMinor === null && medusaRefundAmountMinor === 0) {
      return [];
    }
    const comparableStripeAmount = stripeRefundAmountMinor ?? 0;
    return medusaRefundAmountMinor === comparableStripeAmount
      ? []
      : [
          {
            evidence: record,
            medusaRefundAmountMinor,
            stripeEvidenceAvailable: stripeRefundAmountMinor !== null,
            stripeRefundAmountMinor: comparableStripeAmount,
          },
        ];
  });
};
