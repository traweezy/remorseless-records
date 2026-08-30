import type Stripe from "stripe";

const MAX_ATTEMPTS = 2;
const MAX_NETWORK_RETRIES = 0;
const MAX_REGISTRATIONS = 100;
const MAX_REQUEST_TIMEOUT_MS = 30_000;
const MAX_MISSING_FIELDS = 50;
const MAX_IDENTIFIER_LENGTH = 255;
const MAX_TEXT_LENGTH = 100;
const RETRY_DELAY_MS = 100;

export type StripeTaxReadinessClientErrorCode =
  | "deadline_exceeded"
  | "invalid_request"
  | "invalid_response"
  | "provider_rejected"
  | "provider_unavailable";

export type StripeTaxReadinessRetryEvent = {
  attempt: number;
  operation: "registrations" | "settings";
  reason: "status" | "transport";
  totalAttempts: number;
};

export type StripeTaxReadinessSnapshot = {
  activeRegistrationCount: number;
  hasHeadOffice: boolean;
  livemode: boolean;
  missingFields: string[];
  provider: "anrok" | "avalara" | "sphere" | "stripe";
  status: "active" | "pending";
  taxBehavior: "exclusive" | "inclusive" | "inferred_by_currency" | null;
  taxCode: string | null;
};

export class StripeTaxReadinessClientError extends Error {
  readonly code: StripeTaxReadinessClientErrorCode;

  constructor(code: StripeTaxReadinessClientErrorCode) {
    super(`Stripe Tax readiness failed (${code}).`);
    this.code = code;
    this.name = "StripeTaxReadinessClientError";
  }
}

type UnknownRecord = Record<string, unknown>;
export type StripeTaxReadinessClient = Pick<Stripe, "tax">;

const providers = new Set(["anrok", "avalara", "sphere", "stripe"] as const);
const statuses = new Set(["active", "pending"] as const);
const taxBehaviors = new Set([
  "exclusive",
  "inclusive",
  "inferred_by_currency",
] as const);

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;

const fail = (code: StripeTaxReadinessClientErrorCode): never => {
  throw new StripeTaxReadinessClientError(code);
};

const retryableStatus = (statusCode: number): boolean =>
  statusCode === 408 ||
  statusCode === 409 ||
  statusCode === 425 ||
  statusCode >= 500;

const clientErrorFrom = (error: unknown): StripeTaxReadinessClientError => {
  if (error instanceof StripeTaxReadinessClientError) {
    return error;
  }

  const record = asRecord(error);
  const raw = asRecord(record?.raw);
  const detail = asRecord(raw?.detail);
  if (record?.code === "ETIMEDOUT" || detail?.code === "ETIMEDOUT") {
    return new StripeTaxReadinessClientError("deadline_exceeded");
  }

  const statusCode = record?.statusCode;
  if (typeof statusCode === "number" && Number.isInteger(statusCode)) {
    return new StripeTaxReadinessClientError(
      statusCode === 429 || retryableStatus(statusCode)
        ? "provider_unavailable"
        : "provider_rejected",
    );
  }

  return new StripeTaxReadinessClientError("provider_unavailable");
};

const retryReasonFrom = (
  error: unknown,
): StripeTaxReadinessRetryEvent["reason"] | null => {
  if (error instanceof StripeTaxReadinessClientError) {
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
  return {
    maxNetworkRetries: MAX_NETWORK_RETRIES,
    timeout: remainingMs,
  };
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
  onRetry?: (event: StripeTaxReadinessRetryEvent) => void;
  operation: StripeTaxReadinessRetryEvent["operation"];
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

const boundedEnum = <T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
): T =>
  typeof value === "string" && allowed.has(value as T)
    ? (value as T)
    : fail("invalid_response");

const nullableEnum = <T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
): T | null => (value === null ? null : boundedEnum(value, allowed));

const missingFieldsFrom = (statusDetailsValue: unknown): string[] => {
  const statusDetails = asRecord(statusDetailsValue);
  if (!statusDetails) {
    return fail("invalid_response");
  }
  const pendingValue = statusDetails.pending;
  if (pendingValue === null || pendingValue === undefined) {
    return [];
  }
  const pending = asRecord(pendingValue);
  if (!pending) {
    return fail("invalid_response");
  }
  const fieldsValue = pending.missing_fields;
  if (fieldsValue === null || fieldsValue === undefined) {
    return [];
  }
  if (!Array.isArray(fieldsValue) || fieldsValue.length > MAX_MISSING_FIELDS) {
    return fail("invalid_response");
  }

  const fields = fieldsValue.map((value) => {
    if (typeof value !== "string") {
      return fail("invalid_response");
    }
    const normalized = value.trim();
    return normalized.length > 0 &&
      normalized.length <= MAX_TEXT_LENGTH &&
      /^[A-Za-z0-9_.-]+$/.test(normalized)
      ? normalized
      : fail("invalid_response");
  });
  return new Set(fields).size === fields.length
    ? fields
    : fail("invalid_response");
};

const settingsFrom = (
  value: unknown,
): Omit<StripeTaxReadinessSnapshot, "activeRegistrationCount"> => {
  const settings = asRecord(value);
  const defaults = asRecord(settings?.defaults);
  if (
    settings?.object !== "tax.settings" ||
    !defaults ||
    typeof settings.livemode !== "boolean"
  ) {
    return fail("invalid_response");
  }

  const headOffice = settings.head_office;
  if (headOffice !== null && !asRecord(headOffice)) {
    return fail("invalid_response");
  }
  const taxCode = defaults.tax_code;
  if (
    taxCode !== null &&
    (typeof taxCode !== "string" || !/^txcd_\d{8}$/.test(taxCode))
  ) {
    return fail("invalid_response");
  }

  const status = boundedEnum(settings.status, statuses);
  const missingFields = missingFieldsFrom(settings.status_details);
  if (status === "active" && missingFields.length > 0) {
    return fail("invalid_response");
  }

  return {
    hasHeadOffice: headOffice !== null,
    livemode: settings.livemode,
    missingFields,
    provider: boundedEnum(defaults.provider, providers),
    status,
    taxBehavior: nullableEnum(defaults.tax_behavior, taxBehaviors),
    taxCode,
  };
};

const activeRegistrationCountFrom = (
  value: unknown,
  livemode: boolean,
): number => {
  const registrations = asRecord(value);
  if (
    registrations?.object !== "list" ||
    registrations.has_more !== false ||
    !Array.isArray(registrations.data) ||
    registrations.data.length > MAX_REGISTRATIONS
  ) {
    return fail("invalid_response");
  }

  const identifiers = new Set<string>();
  let count = 0;
  for (const value of registrations.data) {
    const registration = asRecord(value);
    if (
      registration?.object !== "tax.registration" ||
      typeof registration.id !== "string" ||
      registration.id.length > MAX_IDENTIFIER_LENGTH ||
      !/^taxreg_[A-Za-z0-9]+$/.test(registration.id) ||
      registration.status !== "active" ||
      typeof registration.livemode !== "boolean" ||
      registration.livemode !== livemode ||
      identifiers.has(registration.id)
    ) {
      return fail("invalid_response");
    }
    identifiers.add(registration.id);
    count += 1;
  }
  return count;
};

export const readStripeTaxReadiness = async ({
  client,
  onRetry,
  timeoutMs,
}: {
  client: StripeTaxReadinessClient;
  onRetry?: (event: StripeTaxReadinessRetryEvent) => void;
  timeoutMs: number;
}): Promise<StripeTaxReadinessSnapshot> => {
  try {
    const deadlineAt = Date.now() + timeoutFrom(timeoutMs);
    const [settingsResult, registrationsResult] = await Promise.allSettled([
      requestWithRetry({
        deadlineAt,
        ...(onRetry ? { onRetry } : {}),
        operation: "settings",
        request: (options) => client.tax.settings.retrieve({}, options),
      }),
      requestWithRetry({
        deadlineAt,
        ...(onRetry ? { onRetry } : {}),
        operation: "registrations",
        request: (options) =>
          client.tax.registrations.list(
            { limit: MAX_REGISTRATIONS, status: "active" },
            options,
          ),
      }),
    ]);
    if (settingsResult.status === "rejected") {
      throw settingsResult.reason;
    }
    if (registrationsResult.status === "rejected") {
      throw registrationsResult.reason;
    }

    const settings = settingsFrom(settingsResult.value);
    return {
      ...settings,
      activeRegistrationCount: activeRegistrationCountFrom(
        registrationsResult.value,
        settings.livemode,
      ),
    };
  } catch (error) {
    throw clientErrorFrom(error);
  }
};
