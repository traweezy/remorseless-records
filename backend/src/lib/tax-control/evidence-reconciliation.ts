import type {
  TaxCollectionMode,
  TaxProviderName,
  TaxQuoteEvidenceStatus,
} from "../../modules/tax-control/constants";
import type TaxControlModuleService from "../../modules/tax-control/service";
import {
  createStripeEvidenceReader,
  type StripeEvidenceAssociation,
  type StripeEvidenceAssociationAttempt,
  type StripeEvidenceCharge,
  type StripeEvidenceClient,
  type StripeEvidenceIntent,
  type StripeEvidenceReader,
  type StripeEvidenceRetryEvent,
} from "./stripe-evidence-client";

type EvidenceRecord = {
  collection_mode: TaxCollectionMode;
  payment_intent_id: string;
  provider: TaxProviderName | null;
};

type ReconcileTaxEvidenceResult = {
  associationStatus: string;
  evidenceFound: boolean;
  paymentIntentId: string;
  status: TaxQuoteEvidenceStatus | null;
};

const paymentIntentIdPattern = /^pi_[A-Za-z0-9]+$/;

const associationSummary = (
  association: StripeEvidenceAssociation,
): {
  associationStatus: string;
  committedSources: string[];
  errorReasons: string[];
  refundTransactionIds: string[];
  taxTransactionId: string | null;
} => {
  const attempts = association.attempts;
  const errors = attempts
    .filter((attempt) => attempt.status === "errored")
    .map((attempt) => attempt.reason);
  const committedAttempts = attempts.filter(
    (
      attempt,
    ): attempt is Extract<
      StripeEvidenceAssociationAttempt,
      { status: "committed" }
    > => attempt.status === "committed",
  );
  const originalAttempt = committedAttempts.find(
    (attempt) => attempt.source === association.paymentIntentId,
  );
  const taxTransactionId =
    originalAttempt?.transactionId ??
    committedAttempts[0]?.transactionId ??
    null;
  const refundTransactionIds = committedAttempts
    .filter((attempt) => attempt.source !== association.paymentIntentId)
    .map((attempt) => attempt.transactionId);
  const committedSources = committedAttempts
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
  charge: StripeEvidenceCharge | null;
  intent: StripeEvidenceIntent;
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

  const amountRefunded = charge?.amountRefunded ?? 0;
  const capturedAmount = intent.amountReceived;
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
    intent.lastPaymentErrorCode
  ) {
    return "failed";
  }
  return "prepared";
};

export const reconcileTaxQuoteEvidence = async ({
  client,
  onRetry,
  orderId,
  paymentIntentId,
  reader,
  service,
  timeoutMs = 8_000,
}: {
  client: StripeEvidenceClient;
  onRetry?: (event: StripeEvidenceRetryEvent) => void;
  orderId?: string;
  paymentIntentId: string;
  reader?: StripeEvidenceReader;
  service: TaxControlModuleService;
  timeoutMs?: number;
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

  const evidenceReader =
    reader ??
    createStripeEvidenceReader({
      client,
      ...(onRetry ? { onRetry } : {}),
      timeoutMs,
    });
  const snapshot = await evidenceReader.readEvidence({
    paymentIntentId,
    provider: evidence.provider,
  });
  const { association, intent, refunds } = snapshot;
  const { charge } = intent;
  const summary = association
    ? associationSummary(association)
    : {
        associationStatus: "not_applicable",
        committedSources: [] as string[],
        errorReasons: [] as string[],
        refundTransactionIds: [] as string[],
        taxTransactionId: null,
      };
  const refundAmountMinor = charge?.amountRefunded ?? 0;
  const failedRefunds = refunds.filter(
    (refund) => refund.status === "failed" || refund.status === "canceled",
  );
  const refundsAwaitingTaxReversal =
    evidence.provider === "stripe_tax"
      ? refunds.filter(
          (refund) =>
            refund.status !== "failed" &&
            refund.status !== "canceled" &&
            !summary.committedSources.includes(refund.id),
        )
      : [];
  const refundAuditFailures = [
    ...(snapshot.refundsTruncated ? ["refund_list_truncated"] : []),
    ...failedRefunds.map(
      (refund) =>
        `refund_failed:${refund.failureReason ?? refund.status ?? "unknown"}`,
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
      collection_mode: evidence.collection_mode,
      association_error_reasons: summary.errorReasons,
      disputed: charge?.disputed ?? false,
      refund_amount_minor: refundAmountMinor,
      refund_tax_missing_sources: refundsAwaitingTaxReversal.map(
        (refund) => refund.id,
      ),
      refund_tax_transaction_ids: summary.refundTransactionIds,
      stripe_refund_count: refunds.length,
      stripe_refund_failed_count: failedRefunds.length,
      stripe_refund_statuses: refunds.map((refund) => ({
        failure_reason: refund.failureReason,
        id: refund.id,
        status: refund.status,
      })),
      stripe_payment_error_code: intent.lastPaymentErrorCode,
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
