import type Stripe from "stripe";

const MAX_ATTEMPTS = 2;
const MAX_NETWORK_RETRIES = 0;
const MAX_REQUEST_TIMEOUT_MS = 30_000;
const MAX_IDENTIFIER_LENGTH = 255;
const MAX_PAYMENT_AMOUNT = 99_999_999;
const RETRY_DELAY_MS = 100;

const linkableStatuses: ReadonlySet<PaymentIntentStatus> = new Set([
  "requires_confirmation",
  "requires_payment_method",
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

type PaymentIntentStatus = Stripe.PaymentIntent.Status;
type UnknownRecord = Record<string, unknown>;

export type StripePaymentBindingClient = Pick<Stripe, "paymentIntents" | "tax">;

export type StripePaymentBindingClientErrorCode =
  | "calculation_mismatch"
  | "deadline_exceeded"
  | "hook_conflict"
  | "invalid_request"
  | "invalid_response"
  | "not_linkable"
  | "payment_mismatch"
  | "provider_rejected"
  | "provider_unavailable"
  | "tax_identity_mismatch";

export type StripePaymentBindingRetryEvent = {
  attempt: number;
  operation: "retrieve_calculation" | "retrieve_intent" | "update_intent";
  reason: "status" | "transport";
  totalAttempts: number;
};

export type StripePaymentBindingResult = {
  linkedNow: boolean;
  livemode: boolean;
  previouslyLinked: boolean;
  status: PaymentIntentStatus;
};

export class StripePaymentBindingClientError extends Error {
  readonly code: StripePaymentBindingClientErrorCode;

  constructor(code: StripePaymentBindingClientErrorCode) {
    super(`Stripe payment binding failed (${code}).`);
    this.code = code;
    this.name = "StripePaymentBindingClientError";
  }
}

type ExpectedBinding = {
  amountMinor: number;
  calculationId: string | null;
  cartId: string;
  currencyCode: string;
  fingerprint: string;
  generation: number;
  paymentIntentId: string;
  provider: "stripe_tax" | "taxrate_io";
  taxRatePercent: number | null;
};

type PaymentIntentSnapshot = {
  hookedCalculationId: string | null;
  livemode: boolean;
  status: PaymentIntentStatus;
};

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;

const fail = (code: StripePaymentBindingClientErrorCode): never => {
  throw new StripePaymentBindingClientError(code);
};

const retryableStatus = (statusCode: number): boolean =>
  statusCode === 408 ||
  statusCode === 409 ||
  statusCode === 425 ||
  statusCode >= 500;

const clientErrorFrom = (error: unknown): StripePaymentBindingClientError => {
  if (error instanceof StripePaymentBindingClientError) {
    return error;
  }

  const record = asRecord(error);
  const raw = asRecord(record?.raw);
  const detail = asRecord(raw?.detail);
  if (record?.code === "ETIMEDOUT" || detail?.code === "ETIMEDOUT") {
    return new StripePaymentBindingClientError("deadline_exceeded");
  }

  const statusCode = record?.statusCode;
  if (typeof statusCode === "number" && Number.isInteger(statusCode)) {
    return new StripePaymentBindingClientError(
      statusCode === 429 || retryableStatus(statusCode)
        ? "provider_unavailable"
        : "provider_rejected",
    );
  }
  return new StripePaymentBindingClientError("provider_unavailable");
};

const retryReasonFrom = (
  error: unknown,
): StripePaymentBindingRetryEvent["reason"] | null => {
  if (error instanceof StripePaymentBindingClientError) {
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
  onRetry?: (event: StripePaymentBindingRetryEvent) => void;
  operation: StripePaymentBindingRetryEvent["operation"];
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

const boundedId = (value: string, pattern: RegExp): boolean =>
  value.length <= MAX_IDENTIFIER_LENGTH && pattern.test(value);

const expectedBindingFrom = (
  value: ExpectedBinding,
): ExpectedBinding & { idempotencyKey: string } => {
  const idempotencyKey = `rr-tax-link-${value.paymentIntentId}-${value.fingerprint}`;
  const rateValid =
    value.provider === "taxrate_io"
      ? value.calculationId === null &&
        value.taxRatePercent !== null &&
        Number.isFinite(value.taxRatePercent) &&
        value.taxRatePercent >= 0 &&
        value.taxRatePercent <= 100
      : value.taxRatePercent === null &&
        value.calculationId !== null &&
        boundedId(value.calculationId, /^taxcalc_[A-Za-z0-9]+$/);
  if (
    !Number.isSafeInteger(value.amountMinor) ||
    value.amountMinor <= 0 ||
    value.amountMinor > MAX_PAYMENT_AMOUNT ||
    !boundedId(value.paymentIntentId, /^pi_[A-Za-z0-9]+$/) ||
    !boundedId(value.cartId, /^cart_[A-Za-z0-9]+$/) ||
    !/^[a-z]{3}$/.test(value.currencyCode) ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(value.fingerprint) ||
    !Number.isSafeInteger(value.generation) ||
    value.generation <= 0 ||
    !rateValid ||
    idempotencyKey.length > MAX_IDENTIFIER_LENGTH
  ) {
    return fail("invalid_request");
  }
  return { ...value, idempotencyKey };
};

const hookCalculationFrom = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const hooks = asRecord(value);
  if (!hooks) {
    return fail("invalid_response");
  }
  if (hooks.inputs === undefined) {
    return null;
  }
  const inputs = asRecord(hooks.inputs);
  if (!inputs) {
    return fail("invalid_response");
  }
  const taxValue = inputs.tax;
  if (taxValue === null || taxValue === undefined) {
    return null;
  }
  const tax = asRecord(taxValue);
  const calculation = tax?.calculation;
  return typeof calculation === "string" &&
    boundedId(calculation, /^taxcalc_[A-Za-z0-9]+$/)
    ? calculation
    : fail("invalid_response");
};

const paymentIntentFrom = (
  value: unknown,
  expected: ExpectedBinding,
): PaymentIntentSnapshot => {
  const intent = asRecord(value);
  const metadata = asRecord(intent?.metadata);
  if (
    intent?.object !== "payment_intent" ||
    intent.id !== expected.paymentIntentId ||
    !metadata ||
    typeof intent.amount !== "number" ||
    !Number.isSafeInteger(intent.amount) ||
    typeof intent.currency !== "string" ||
    typeof intent.livemode !== "boolean" ||
    typeof intent.status !== "string" ||
    !paymentIntentStatuses.has(intent.status as PaymentIntentStatus)
  ) {
    return fail("invalid_response");
  }
  if (
    intent.amount !== expected.amountMinor ||
    intent.currency !== expected.currencyCode
  ) {
    return fail("payment_mismatch");
  }

  const generation = metadata.rr_tax_generation;
  const calculation = metadata.rr_tax_calculation_id;
  const rate = metadata.rr_tax_rate_percent;
  const calculationMatches =
    expected.calculationId === null
      ? calculation === undefined || calculation === ""
      : calculation === expected.calculationId;
  const rateMatches =
    expected.provider === "taxrate_io"
      ? typeof rate === "string" &&
        /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(rate) &&
        Number.isFinite(Number(rate)) &&
        Number(rate) >= 0 &&
        Number(rate) <= 100 &&
        Number(rate) === expected.taxRatePercent
      : rate === undefined || rate === "";
  if (
    metadata.medusa_cart_id !== expected.cartId ||
    metadata.rr_tax_provider !== expected.provider ||
    generation !== String(expected.generation) ||
    metadata.rr_tax_fingerprint !== expected.fingerprint ||
    !calculationMatches ||
    !rateMatches
  ) {
    return fail("tax_identity_mismatch");
  }

  return {
    hookedCalculationId: hookCalculationFrom(intent.hooks),
    livemode: intent.livemode,
    status: intent.status as PaymentIntentStatus,
  };
};

const calculationFrom = (
  value: unknown,
  expected: ExpectedBinding,
  livemode: boolean,
): void => {
  const calculation = asRecord(value);
  if (
    calculation?.object !== "tax.calculation" ||
    calculation.id !== expected.calculationId ||
    typeof calculation.amount_total !== "number" ||
    !Number.isSafeInteger(calculation.amount_total) ||
    typeof calculation.currency !== "string" ||
    typeof calculation.livemode !== "boolean" ||
    (calculation.expires_at !== null &&
      (typeof calculation.expires_at !== "number" ||
        !Number.isSafeInteger(calculation.expires_at)))
  ) {
    return fail("invalid_response");
  }
  if (
    calculation.amount_total !== expected.amountMinor ||
    calculation.currency !== expected.currencyCode ||
    calculation.livemode !== livemode ||
    calculation.expires_at === null ||
    calculation.expires_at <= Math.floor(Date.now() / 1_000)
  ) {
    return fail("calculation_mismatch");
  }
};

export const verifyAndLinkStripePayment = async ({
  client,
  onRetry,
  timeoutMs,
  ...input
}: ExpectedBinding & {
  client: StripePaymentBindingClient;
  onRetry?: (event: StripePaymentBindingRetryEvent) => void;
  timeoutMs: number;
}): Promise<StripePaymentBindingResult> => {
  try {
    const expected = expectedBindingFrom(input);
    const deadlineAt = Date.now() + timeoutFrom(timeoutMs);
    const calculationId = expected.calculationId;
    const [intentResult, calculationResult] = await Promise.allSettled([
      requestWithRetry({
        deadlineAt,
        ...(onRetry ? { onRetry } : {}),
        operation: "retrieve_intent",
        request: (options) =>
          client.paymentIntents.retrieve(expected.paymentIntentId, {}, options),
      }),
      calculationId
        ? requestWithRetry({
            deadlineAt,
            ...(onRetry ? { onRetry } : {}),
            operation: "retrieve_calculation",
            request: (options) =>
              client.tax.calculations.retrieve(calculationId, {}, options),
          })
        : Promise.resolve(null),
    ]);
    if (intentResult.status === "rejected") {
      throw intentResult.reason;
    }
    if (calculationResult.status === "rejected") {
      throw calculationResult.reason;
    }
    const intentValue = intentResult.value;
    const calculationValue = calculationResult.value;

    const intent = paymentIntentFrom(intentValue, expected);
    if (calculationValue !== null) {
      calculationFrom(calculationValue, expected, intent.livemode);
    }
    if (
      intent.hookedCalculationId !== null &&
      intent.hookedCalculationId !== expected.calculationId
    ) {
      return fail("hook_conflict");
    }
    if (calculationId === null) {
      return {
        linkedNow: false,
        livemode: intent.livemode,
        previouslyLinked: false,
        status: intent.status,
      };
    }
    if (intent.hookedCalculationId === calculationId) {
      return {
        linkedNow: false,
        livemode: intent.livemode,
        previouslyLinked: true,
        status: intent.status,
      };
    }
    if (!linkableStatuses.has(intent.status)) {
      return fail("not_linkable");
    }

    const updatedValue = await requestWithRetry({
      deadlineAt,
      ...(onRetry ? { onRetry } : {}),
      operation: "update_intent",
      request: (options) =>
        client.paymentIntents.update(
          expected.paymentIntentId,
          {
            hooks: {
              inputs: {
                tax: { calculation: calculationId },
              },
            },
            metadata: {
              medusa_cart_id: expected.cartId,
              rr_tax_calculation_id: calculationId,
              rr_tax_fingerprint: expected.fingerprint,
              rr_tax_generation: String(expected.generation),
              rr_tax_provider: expected.provider,
            },
          },
          { ...options, idempotencyKey: expected.idempotencyKey },
        ),
    });
    const updated = paymentIntentFrom(updatedValue, expected);
    if (
      updated.hookedCalculationId !== calculationId ||
      updated.livemode !== intent.livemode
    ) {
      return fail("invalid_response");
    }
    return {
      linkedNow: true,
      livemode: updated.livemode,
      previouslyLinked: false,
      status: updated.status,
    };
  } catch (error) {
    throw clientErrorFrom(error);
  }
};
