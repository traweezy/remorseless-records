import type Stripe from "stripe";

import {
  stripeLifecycleEventTypes,
  type StripeLifecycleEventType,
} from "../../modules/payment-lifecycle/constants";

const MAX_ASSOCIATION_ATTEMPTS = 500;
const MAX_ATTEMPTS = 2;
const MAX_IDENTIFIER_LENGTH = 255;
const MAX_NETWORK_RETRIES = 0;
const MAX_REFUNDS = 100;
const MAX_REQUEST_TIMEOUT_MS = 30_000;
const MAX_TEXT_LENGTH = 100;
const RETRY_DELAY_MS = 100;

const associationErrorReasons = new Set([
  "another_payment_associated_with_calculation",
  "calculation_expired",
  "currency_mismatch",
  "original_transaction_voided",
  "unique_reference_violation",
] as const);
const disputeStatuses = new Set([
  "lost",
  "needs_response",
  "prevented",
  "under_review",
  "warning_closed",
  "warning_needs_response",
  "warning_under_review",
  "won",
] as const);
const paymentIntentStatuses = new Set([
  "canceled",
  "processing",
  "requires_action",
  "requires_capture",
  "requires_confirmation",
  "requires_payment_method",
  "succeeded",
] as const);
const refundFailureReasons = new Set([
  "charge_for_pending_refund_disputed",
  "declined",
  "expired_or_canceled_card",
  "insufficient_funds",
  "lost_or_stolen_card",
  "merchant_request",
  "unknown",
] as const);
const refundStatuses = new Set([
  "canceled",
  "failed",
  "pending",
  "requires_action",
  "succeeded",
] as const);
const supportedLifecycleEventTypes = new Set<StripeLifecycleEventType>(
  stripeLifecycleEventTypes,
);

type AssociationErrorReason =
  Stripe.Tax.Association.TaxTransactionAttempt.Errored.Reason;
type DisputeStatus = Stripe.Dispute.Status;
type PaymentIntentStatus = Stripe.PaymentIntent.Status;
type RefundStatus =
  | "canceled"
  | "failed"
  | "pending"
  | "requires_action"
  | "succeeded";
type UnknownRecord = Record<string, unknown>;

export type StripeEvidenceClient = Pick<
  Stripe,
  "disputes" | "paymentIntents" | "refunds" | "tax"
>;

export type StripeEvidenceClientErrorCode =
  | "deadline_exceeded"
  | "invalid_request"
  | "invalid_response"
  | "provider_rejected"
  | "provider_unavailable";

export type StripeEvidenceRetryEvent = {
  attempt: number;
  operation:
    | "find_association"
    | "list_refunds"
    | "retrieve_dispute"
    | "retrieve_intent"
    | "retrieve_refund";
  reason: "status" | "transport";
  totalAttempts: number;
};

export type StripeEvidenceAssociationAttempt =
  | {
      source: string;
      status: "committed";
      transactionId: string;
    }
  | {
      reason: AssociationErrorReason;
      source: string;
      status: "errored";
    };

export type StripeEvidenceAssociation = {
  attempts: StripeEvidenceAssociationAttempt[];
  calculationId: string;
  id: string;
  paymentIntentId: string;
};

export type StripeEvidenceCharge = {
  amountRefunded: number;
  disputed: boolean;
  id: string;
};

export type StripeEvidenceIntent = {
  amountReceived: number;
  charge: StripeEvidenceCharge | null;
  id: string;
  lastPaymentErrorCode: string | null;
  livemode: boolean;
  orderId: string | null;
  status: PaymentIntentStatus;
};

export type StripeEvidenceRefund = {
  amount: number;
  failureReason: string | null;
  id: string;
  status: RefundStatus | null;
};

export type StripeEvidenceSnapshot = {
  association: StripeEvidenceAssociation | null;
  intent: StripeEvidenceIntent;
  refunds: StripeEvidenceRefund[];
  refundsTruncated: boolean;
};

export type StripeLifecycleObjectSnapshot = {
  amountMinor: number;
  currencyCode: string;
  id: string;
  livemode: boolean | null;
  paymentIntentId: string | null;
  status: string | null;
};

export type StripeEvidenceReader = {
  readEvidence: (input: {
    paymentIntentId: string;
    provider: "stripe_tax" | "taxrate_io";
  }) => Promise<StripeEvidenceSnapshot>;
  readLifecycleObject: (input: {
    eventType: string;
    objectId: string;
  }) => Promise<StripeLifecycleObjectSnapshot>;
  readIntent: (paymentIntentId: string) => Promise<StripeEvidenceIntent>;
};

export class StripeEvidenceClientError extends Error {
  readonly code: StripeEvidenceClientErrorCode;

  constructor(code: StripeEvidenceClientErrorCode) {
    super(`Stripe evidence read failed (${code}).`);
    this.code = code;
    this.name = "StripeEvidenceClientError";
  }
}

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;

const fail = (code: StripeEvidenceClientErrorCode): never => {
  throw new StripeEvidenceClientError(code);
};

const boundedId = (value: unknown, pattern: RegExp): value is string =>
  typeof value === "string" &&
  value.length <= MAX_IDENTIFIER_LENGTH &&
  pattern.test(value);

const boundedEnum = <T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
): T =>
  typeof value === "string" && allowed.has(value as T)
    ? (value as T)
    : fail("invalid_response");

const nonnegativeInteger = (value: unknown): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : fail("invalid_response");

const positiveInteger = (value: unknown): number => {
  const parsed = nonnegativeInteger(value);
  return parsed > 0 ? parsed : fail("invalid_response");
};

const currencyFrom = (value: unknown): string =>
  typeof value === "string" && /^[a-z]{3}$/.test(value)
    ? value
    : fail("invalid_response");

const expandableId = (value: unknown, pattern: RegExp): string | null => {
  if (value === null) {
    return null;
  }
  if (boundedId(value, pattern)) {
    return value;
  }
  const record = asRecord(value);
  return boundedId(record?.id, pattern)
    ? (record.id as string)
    : fail("invalid_response");
};

const optionalSafeToken = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_TEXT_LENGTH &&
    /^[a-z0-9_]+$/.test(value)
    ? value
    : fail("invalid_response");
};

const retryableStatus = (statusCode: number): boolean =>
  statusCode === 408 ||
  statusCode === 409 ||
  statusCode === 425 ||
  statusCode >= 500;

const clientErrorFrom = (error: unknown): StripeEvidenceClientError => {
  if (error instanceof StripeEvidenceClientError) {
    return error;
  }

  const record = asRecord(error);
  const raw = asRecord(record?.raw);
  const detail = asRecord(raw?.detail);
  if (record?.code === "ETIMEDOUT" || detail?.code === "ETIMEDOUT") {
    return new StripeEvidenceClientError("deadline_exceeded");
  }

  const statusCode = record?.statusCode;
  if (typeof statusCode === "number" && Number.isInteger(statusCode)) {
    return new StripeEvidenceClientError(
      statusCode === 429 || retryableStatus(statusCode)
        ? "provider_unavailable"
        : "provider_rejected",
    );
  }
  return new StripeEvidenceClientError("provider_unavailable");
};

const retryReasonFrom = (
  error: unknown,
): StripeEvidenceRetryEvent["reason"] | null => {
  if (error instanceof StripeEvidenceClientError) {
    return null;
  }

  const record = asRecord(error);
  const raw = asRecord(record?.raw);
  const detail = asRecord(raw?.detail);
  const headers = asRecord(record?.headers);
  const retryHeader = headers?.["stripe-should-retry"];
  if (retryHeader === "false") {
    return null;
  }
  if (
    record?.code === "ETIMEDOUT" ||
    detail?.code === "ETIMEDOUT" ||
    record?.type === "StripeConnectionError"
  ) {
    return "transport";
  }

  const statusCode = record?.statusCode;
  if (typeof statusCode !== "number" || !Number.isInteger(statusCode)) {
    return null;
  }
  if (statusCode === 429) {
    return null;
  }
  return retryHeader === "true" || retryableStatus(statusCode)
    ? "status"
    : null;
};

const timeoutFrom = (value: number): number =>
  Number.isSafeInteger(value) && value > 0 && value <= MAX_REQUEST_TIMEOUT_MS
    ? value
    : fail("invalid_request");

const requestOptions = (deadlineAt: number): Stripe.RequestOptions => {
  const remainingMs = Math.ceil(deadlineAt - Date.now());
  if (remainingMs <= 0) {
    return fail("deadline_exceeded");
  }
  return { maxNetworkRetries: MAX_NETWORK_RETRIES, timeout: remainingMs };
};

const waitForRetry = async (deadlineAt: number): Promise<void> => {
  if (deadlineAt - Date.now() <= RETRY_DELAY_MS) {
    return fail("deadline_exceeded");
  }
  await new Promise<void>((resolve) => {
    setTimeout(resolve, RETRY_DELAY_MS);
  });
};

const requestWithRetry = async <T>({
  deadlineAt,
  onRetry,
  operation,
  request,
}: {
  deadlineAt: number;
  onRetry?: (event: StripeEvidenceRetryEvent) => void;
  operation: StripeEvidenceRetryEvent["operation"];
  request: (options: Stripe.RequestOptions) => Promise<T>;
}): Promise<T> => {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await request(requestOptions(deadlineAt));
    } catch (error) {
      const reason = retryReasonFrom(error);
      if (attempt === MAX_ATTEMPTS || reason === null) {
        throw clientErrorFrom(error);
      }
      onRetry?.({
        attempt: attempt + 1,
        operation,
        reason,
        totalAttempts: MAX_ATTEMPTS,
      });
      await waitForRetry(deadlineAt);
    }
  }
  return fail("provider_unavailable");
};

const chargeFrom = (value: unknown): StripeEvidenceCharge | null => {
  if (value === null) {
    return null;
  }
  const charge = asRecord(value);
  if (
    charge?.object !== "charge" ||
    !boundedId(charge.id, /^ch_[A-Za-z0-9]+$/) ||
    typeof charge.disputed !== "boolean"
  ) {
    return fail("invalid_response");
  }
  return {
    amountRefunded: nonnegativeInteger(charge.amount_refunded),
    disputed: charge.disputed,
    id: charge.id,
  };
};

const orderIdFrom = (metadataValue: unknown): string | null => {
  const metadata = asRecord(metadataValue);
  if (!metadata) {
    return fail("invalid_response");
  }
  const value = metadata.medusa_order_id;
  if (value === undefined || value === "") {
    return null;
  }
  return boundedId(value, /^order_[A-Za-z0-9]+$/)
    ? value
    : fail("invalid_response");
};

const paymentErrorCodeFrom = (value: unknown): string | null => {
  if (value === null) {
    return null;
  }
  const error = asRecord(value);
  return error ? optionalSafeToken(error.code) : fail("invalid_response");
};

const intentFrom = (
  value: unknown,
  expectedId: string,
): StripeEvidenceIntent => {
  const intent = asRecord(value);
  if (
    intent?.object !== "payment_intent" ||
    intent.id !== expectedId ||
    typeof intent.livemode !== "boolean"
  ) {
    return fail("invalid_response");
  }
  const amountReceived = nonnegativeInteger(intent.amount_received);
  const charge = chargeFrom(intent.latest_charge);
  if (charge && charge.amountRefunded > amountReceived) {
    return fail("invalid_response");
  }
  return {
    amountReceived,
    charge,
    id: expectedId,
    lastPaymentErrorCode: paymentErrorCodeFrom(intent.last_payment_error),
    livemode: intent.livemode,
    orderId: orderIdFrom(intent.metadata),
    status: boundedEnum(intent.status, paymentIntentStatuses),
  };
};

const associationAttemptFrom = (
  value: unknown,
): StripeEvidenceAssociationAttempt => {
  const attempt = asRecord(value);
  if (!attempt) {
    return fail("invalid_response");
  }
  const source = attempt.source;
  if (
    !boundedId(source, /^(?:pi|re)_[A-Za-z0-9]+$/) ||
    (attempt.status !== "committed" && attempt.status !== "errored")
  ) {
    return fail("invalid_response");
  }
  if (attempt.status === "committed") {
    const committed = asRecord(attempt.committed);
    if (
      attempt.errored !== undefined ||
      !boundedId(committed?.transaction, /^tax_[A-Za-z0-9]+$/)
    ) {
      return fail("invalid_response");
    }
    return {
      source,
      status: "committed",
      transactionId: committed.transaction,
    };
  }

  const errored = asRecord(attempt.errored);
  if (attempt.committed !== undefined || !errored) {
    return fail("invalid_response");
  }
  return {
    reason: boundedEnum(errored.reason, associationErrorReasons),
    source,
    status: "errored",
  };
};

const associationFrom = (
  value: unknown,
  paymentIntentId: string,
): StripeEvidenceAssociation => {
  const association = asRecord(value);
  if (
    association?.object !== "tax.association" ||
    !boundedId(association.id, /^taxa_[A-Za-z0-9]+$/) ||
    !boundedId(association.calculation, /^taxcalc_[A-Za-z0-9]+$/) ||
    association.payment_intent !== paymentIntentId ||
    (association.tax_transaction_attempts !== null &&
      !Array.isArray(association.tax_transaction_attempts))
  ) {
    return fail("invalid_response");
  }
  const values = association.tax_transaction_attempts ?? [];
  if (values.length > MAX_ASSOCIATION_ATTEMPTS) {
    return fail("invalid_response");
  }
  return {
    attempts: values.map(associationAttemptFrom),
    calculationId: association.calculation,
    id: association.id,
    paymentIntentId,
  };
};

const refundFrom = (
  value: unknown,
  expectedPaymentIntentId?: string,
): StripeEvidenceRefund & {
  currencyCode: string;
  paymentIntentId: string | null;
} => {
  const refund = asRecord(value);
  if (
    refund?.object !== "refund" ||
    !boundedId(refund.id, /^re_[A-Za-z0-9]+$/)
  ) {
    return fail("invalid_response");
  }
  const paymentIntentId = expandableId(
    refund.payment_intent,
    /^pi_[A-Za-z0-9]+$/,
  );
  if (
    expectedPaymentIntentId !== undefined &&
    paymentIntentId !== expectedPaymentIntentId
  ) {
    return fail("invalid_response");
  }
  const status =
    refund.status === null
      ? null
      : boundedEnum(refund.status, refundStatuses);
  const failureReason =
    refund.failure_reason === null || refund.failure_reason === undefined
      ? null
      : boundedEnum(refund.failure_reason, refundFailureReasons);
  return {
    amount: positiveInteger(refund.amount),
    currencyCode: currencyFrom(refund.currency),
    failureReason,
    id: refund.id,
    paymentIntentId,
    status,
  };
};

const refundsFrom = (
  value: unknown,
  paymentIntentId: string,
): Pick<StripeEvidenceSnapshot, "refunds" | "refundsTruncated"> => {
  const list = asRecord(value);
  if (
    list?.object !== "list" ||
    list.url !== "/v1/refunds" ||
    typeof list.has_more !== "boolean" ||
    !Array.isArray(list.data) ||
    list.data.length > MAX_REFUNDS
  ) {
    return fail("invalid_response");
  }
  const refunds = list.data.map((entry) =>
    refundFrom(entry, paymentIntentId),
  );
  const ids = refunds.map((refund) => refund.id);
  if (new Set(ids).size !== ids.length) {
    return fail("invalid_response");
  }
  return {
    refunds: refunds.map(({ amount, failureReason, id, status }) => ({
      amount,
      failureReason,
      id,
      status,
    })),
    refundsTruncated: list.has_more,
  };
};

const disputeFrom = (
  value: unknown,
  expectedId: string,
): StripeLifecycleObjectSnapshot => {
  const dispute = asRecord(value);
  if (
    dispute?.object !== "dispute" ||
    dispute.id !== expectedId ||
    typeof dispute.livemode !== "boolean"
  ) {
    return fail("invalid_response");
  }
  return {
    amountMinor: positiveInteger(dispute.amount),
    currencyCode: currencyFrom(dispute.currency),
    id: expectedId,
    livemode: dispute.livemode,
    paymentIntentId: expandableId(
      dispute.payment_intent,
      /^pi_[A-Za-z0-9]+$/,
    ),
    status: boundedEnum<DisputeStatus>(dispute.status, disputeStatuses),
  };
};

const lifecycleRefundFrom = (
  value: unknown,
  expectedId: string,
): StripeLifecycleObjectSnapshot => {
  const refund = refundFrom(value);
  if (refund.id !== expectedId) {
    return fail("invalid_response");
  }
  return {
    amountMinor: refund.amount,
    currencyCode: refund.currencyCode,
    id: refund.id,
    livemode: null,
    paymentIntentId: refund.paymentIntentId,
    status: refund.status,
  };
};

const settledValue = <T>(result: PromiseSettledResult<T>): T =>
  result.status === "fulfilled" ? result.value : failFrom(result.reason);

const failFrom = (error: unknown): never => {
  throw clientErrorFrom(error);
};

export const createStripeEvidenceReader = ({
  client,
  onRetry,
  timeoutMs,
}: {
  client: StripeEvidenceClient;
  onRetry?: (event: StripeEvidenceRetryEvent) => void;
  timeoutMs: number;
}): StripeEvidenceReader => {
  const deadlineAt = Date.now() + timeoutFrom(timeoutMs);
  const retryInput = onRetry ? { onRetry } : {};
  const intents = new Map<string, Promise<StripeEvidenceIntent>>();
  const readIntent = (
    paymentIntentId: string,
  ): Promise<StripeEvidenceIntent> => {
    if (!boundedId(paymentIntentId, /^pi_[A-Za-z0-9]+$/)) {
      return Promise.reject(new StripeEvidenceClientError("invalid_request"));
    }
    const existing = intents.get(paymentIntentId);
    if (existing) {
      return existing;
    }
    const request = requestWithRetry({
      deadlineAt,
      ...retryInput,
      operation: "retrieve_intent",
      request: (options) =>
        client.paymentIntents.retrieve(
          paymentIntentId,
          { expand: ["latest_charge"] },
          options,
        ),
    }).then((value) => intentFrom(value, paymentIntentId));
    intents.set(paymentIntentId, request);
    return request;
  };

  return {
    readEvidence: async ({ paymentIntentId, provider }) => {
      if (
        !boundedId(paymentIntentId, /^pi_[A-Za-z0-9]+$/) ||
        (provider !== "stripe_tax" && provider !== "taxrate_io")
      ) {
        return fail("invalid_request");
      }
      const [intentResult, associationResult, refundsResult] =
        await Promise.allSettled([
          readIntent(paymentIntentId),
          provider === "stripe_tax"
            ? requestWithRetry({
                deadlineAt,
                ...retryInput,
                operation: "find_association",
                request: (options) =>
                  client.tax.associations.find(
                    { payment_intent: paymentIntentId },
                    options,
                  ),
              })
            : Promise.resolve(null),
          requestWithRetry({
            deadlineAt,
            ...retryInput,
            operation: "list_refunds",
            request: (options) =>
              client.refunds.list(
                { limit: MAX_REFUNDS, payment_intent: paymentIntentId },
                options,
              ),
          }),
        ]);
      const intent = settledValue(intentResult);
      const associationValue = settledValue(associationResult);
      const refunds = refundsFrom(
        settledValue(refundsResult),
        paymentIntentId,
      );
      return {
        association:
          associationValue === null
            ? null
            : associationFrom(associationValue, paymentIntentId),
        intent,
        ...refunds,
      };
    },
    readLifecycleObject: async ({ eventType, objectId }) => {
      if (
        !supportedLifecycleEventTypes.has(eventType as StripeLifecycleEventType)
      ) {
        return fail("invalid_request");
      }
      if (eventType.startsWith("refund.")) {
        if (!boundedId(objectId, /^re_[A-Za-z0-9]+$/)) {
          return fail("invalid_request");
        }
        const value = await requestWithRetry({
          deadlineAt,
          ...retryInput,
          operation: "retrieve_refund",
          request: (options) =>
            client.refunds.retrieve(objectId, {}, options),
        });
        return lifecycleRefundFrom(value, objectId);
      }
      if (!boundedId(objectId, /^du_[A-Za-z0-9]+$/)) {
        return fail("invalid_request");
      }
      const value = await requestWithRetry({
        deadlineAt,
        ...retryInput,
        operation: "retrieve_dispute",
        request: (options) =>
          client.disputes.retrieve(objectId, {}, options),
      });
      return disputeFrom(value, objectId);
    },
    readIntent,
  };
};
