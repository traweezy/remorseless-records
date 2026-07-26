import type Stripe from "stripe";

import type {
  TaxProviderName,
  TaxQuoteEvidenceStatus,
} from "../../modules/tax-control/constants";
import type TaxControlModuleService from "../../modules/tax-control/service";

type EvidenceRecord = {
  payment_intent_id: string;
  provider: TaxProviderName;
};

type ReconcileTaxEvidenceResult = {
  associationStatus: string;
  evidenceFound: boolean;
  paymentIntentId: string;
  status: TaxQuoteEvidenceStatus | null;
};

const paymentIntentIdPattern = /^pi_[A-Za-z0-9]+$/;

const chargeFrom = (
  value: string | Stripe.Charge | null,
): Stripe.Charge | null => (value && typeof value === "object" ? value : null);

const associationSummary = (
  association: Stripe.Tax.Association,
): {
  associationStatus: string;
  committedSources: string[];
  errorReasons: string[];
  refundTransactionIds: string[];
  taxTransactionId: string | null;
} => {
  const attempts = association.tax_transaction_attempts ?? [];
  const errors = attempts
    .map((attempt) => attempt.errored?.reason)
    .filter((reason): reason is NonNullable<typeof reason> => Boolean(reason));
  const originalAttempt = attempts.find(
    (attempt) =>
      attempt.source === association.payment_intent &&
      attempt.status === "committed",
  );
  const taxTransactionId =
    originalAttempt?.committed?.transaction ??
    attempts.find((attempt) => attempt.status === "committed")?.committed
      ?.transaction ??
    null;
  const refundTransactionIds = attempts
    .filter(
      (attempt) =>
        attempt.source !== association.payment_intent &&
        attempt.status === "committed",
    )
    .map((attempt) => attempt.committed?.transaction)
    .filter((id): id is string => Boolean(id));
  const committedSources = attempts
    .filter((attempt) => attempt.status === "committed")
    .map((attempt) => attempt.source)
    .filter((source): source is string => Boolean(source));

  return {
    associationStatus: errors.length
      ? `errored:${errors.join(",")}`
      : taxTransactionId
        ? "committed"
        : "pending",
    committedSources,
    errorReasons: errors,
    refundTransactionIds,
    taxTransactionId,
  };
};

const evidenceStatus = ({
  associationFailed,
  charge,
  intent,
}: {
  associationFailed: boolean;
  charge: Stripe.Charge | null;
  intent: Stripe.PaymentIntent;
}): TaxQuoteEvidenceStatus => {
  if (charge?.disputed) {
    return "disputed";
  }
  if (associationFailed) {
    return "association_failed";
  }
  if (intent.status === "canceled") {
    return "canceled";
  }

  const amountRefunded = Math.max(0, charge?.amount_refunded ?? 0);
  const capturedAmount = Math.max(0, intent.amount_received);
  if (capturedAmount > 0 && amountRefunded >= capturedAmount) {
    return "refunded";
  }
  if (amountRefunded > 0) {
    return "partially_refunded";
  }
  if (intent.status === "succeeded") {
    return "succeeded";
  }
  if (
    intent.status === "requires_payment_method" &&
    intent.last_payment_error
  ) {
    return "failed";
  }
  return "prepared";
};

export const reconcileTaxQuoteEvidence = async ({
  client,
  orderId,
  paymentIntentId,
  service,
}: {
  client: Stripe;
  orderId?: string;
  paymentIntentId: string;
  service: TaxControlModuleService;
}): Promise<ReconcileTaxEvidenceResult> => {
  if (!paymentIntentIdPattern.test(paymentIntentId)) {
    throw new Error("A valid Stripe PaymentIntent ID is required.");
  }

  const evidence = (
    await service.listTaxQuoteEvidences(
      { payment_intent_id: paymentIntentId },
      { take: 1 },
    )
  )[0] as EvidenceRecord | undefined;
  if (!evidence) {
    return {
      associationStatus: "not_tracked",
      evidenceFound: false,
      paymentIntentId,
      status: null,
    };
  }

  const intent = await client.paymentIntents.retrieve(paymentIntentId, {
    expand: ["latest_charge"],
  });
  const charge = chargeFrom(intent.latest_charge);
  const [association, refunds] = await Promise.all([
    evidence.provider === "stripe_tax"
      ? client.tax.associations.find({
          payment_intent: paymentIntentId,
        })
      : Promise.resolve(null),
    client.refunds.list({ limit: 100, payment_intent: paymentIntentId }),
  ]);
  const summary = association
    ? associationSummary(association)
    : {
        associationStatus: "not_applicable",
        committedSources: [] as string[],
        errorReasons: [] as string[],
        refundTransactionIds: [] as string[],
        taxTransactionId: null,
      };
  const refundAmountMinor = Math.max(0, charge?.amount_refunded ?? 0);
  const failedRefunds = refunds.data.filter(
    (refund) => refund.status === "failed" || refund.status === "canceled",
  );
  const refundsAwaitingTaxReversal =
    evidence.provider === "stripe_tax"
      ? refunds.data.filter(
          (refund) =>
            refund.status !== "failed" &&
            refund.status !== "canceled" &&
            !summary.committedSources.includes(refund.id),
        )
      : [];
  const refundAuditFailures = [
    ...(refunds.has_more ? ["refund_list_truncated"] : []),
    ...failedRefunds.map(
      (refund) =>
        `refund_failed:${refund.failure_reason ?? refund.status ?? "unknown"}`,
    ),
  ];
  const associationStatus =
    refundAuditFailures.length > 0
      ? refundAuditFailures.join(",")
      : evidence.provider === "stripe_tax" &&
          refundsAwaitingTaxReversal.length > 0 &&
          summary.errorReasons.length === 0
        ? "refund_pending"
        : summary.associationStatus;
  const status = evidenceStatus({
    associationFailed:
      summary.errorReasons.length > 0 || refundAuditFailures.length > 0,
    charge,
    intent,
  });

  await service.updateTaxQuoteEvidenceLifecycle({
    associationStatus,
    metadata: {
      association_error_reasons: summary.errorReasons,
      disputed: charge?.disputed ?? false,
      refund_amount_minor: refundAmountMinor,
      refund_tax_missing_sources: refundsAwaitingTaxReversal.map(
        (refund) => refund.id,
      ),
      refund_tax_transaction_ids: summary.refundTransactionIds,
      stripe_refund_count: refunds.data.length,
      stripe_refund_failed_count: failedRefunds.length,
      stripe_refund_statuses: refunds.data.map((refund) => ({
        failure_reason: refund.failure_reason,
        id: refund.id,
        status: refund.status,
      })),
      stripe_payment_error_code: intent.last_payment_error?.code ?? null,
      stripe_payment_status: intent.status,
    },
    ...(orderId ? { orderId } : {}),
    paymentIntentId,
    status,
    taxTransactionId: summary.taxTransactionId,
  });

  return {
    associationStatus,
    evidenceFound: true,
    paymentIntentId,
    status,
  };
};
