import { BigNumber, MathBN } from "@medusajs/framework/utils";
import type { BigNumberInput } from "@medusajs/framework/types";

const CHECKOUT_CURRENCY = "usd";
const STRIPE_PROVIDER_ID = "pp_stripe_stripe";
const USD_MINOR_UNIT_MULTIPLIER = 100;
const STRIPE_MIN_USD_AMOUNT = 50;
const STRIPE_MAX_AMOUNT = 99_999_999;

const PROCESSABLE_PAYMENT_STATUSES = new Set([
  "pending",
  "requires_more",
  "authorized",
  "captured",
  "pending_authorization",
]);

export type CheckoutPaymentValidationCode =
  | "checkout_address_missing"
  | "checkout_cart_empty"
  | "checkout_contact_missing"
  | "checkout_currency_invalid"
  | "checkout_money_invalid"
  | "checkout_payment_amount_mismatch"
  | "checkout_payment_collection_missing"
  | "checkout_payment_currency_mismatch"
  | "checkout_payment_session_invalid"
  | "checkout_payment_session_missing"
  | "checkout_payment_session_multiple"
  | "checkout_payment_session_provider_invalid"
  | "checkout_shipping_missing";

export class CheckoutPaymentValidationError extends Error {
  readonly code: CheckoutPaymentValidationCode;

  constructor(code: CheckoutPaymentValidationCode, detail: string) {
    super(detail);
    this.name = "CheckoutPaymentValidationError";
    this.code = code;
  }
}

type CheckoutPaymentValidationResult = {
  currencyCode: string;
  paymentSessionStatus: string | null;
  total: string;
};

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object"
    ? (value as UnknownRecord)
    : null;

const asRecordArray = (value: unknown): UnknownRecord[] =>
  Array.isArray(value)
    ? value
        .map(asRecord)
        .filter((record): record is UnknownRecord => record !== null)
    : [];

const normalizedString = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const requiredString = (value: unknown): boolean =>
  typeof value === "string" && value.trim().length > 0;

const moneyValue = (
  value: unknown,
  name: string,
): ReturnType<typeof MathBN.convert> => {
  try {
    const amount = MathBN.convert(value as BigNumberInput);
    if (!amount.isFinite() || amount.isNegative()) {
      throw new Error("invalid");
    }
    return amount;
  } catch {
    throw new CheckoutPaymentValidationError(
      "checkout_money_invalid",
      `${name} must be a finite, non-negative USD amount.`,
    );
  }
};

const payableUsdMinorUnits = (
  amount: ReturnType<typeof MathBN.convert>,
  name: string,
): number => {
  const multiplied = new BigNumber(
    MathBN.mult(amount, USD_MINOR_UNIT_MULTIPLIER),
  ).numeric;
  const minorUnits = Math.round(multiplied);
  if (
    !Number.isSafeInteger(minorUnits) ||
    minorUnits < STRIPE_MIN_USD_AMOUNT ||
    minorUnits > STRIPE_MAX_AMOUNT
  ) {
    throw new CheckoutPaymentValidationError(
      "checkout_money_invalid",
      `${name} is outside Stripe's supported USD amount range.`,
    );
  }
  return minorUnits;
};

const amountFrom = (record: UnknownRecord, name: string) =>
  moneyValue(record.raw_amount ?? record.amount, name);

const assertAddress = (value: unknown): void => {
  const address = asRecord(value);
  if (
    !address ||
    !requiredString(address.first_name) ||
    !requiredString(address.last_name) ||
    !requiredString(address.address_1) ||
    !requiredString(address.city) ||
    !requiredString(address.postal_code) ||
    normalizedString(address.country_code) !== "us"
  ) {
    throw new CheckoutPaymentValidationError(
      "checkout_address_missing",
      "A complete US delivery address is required.",
    );
  }
};

export const validateCheckoutPayment = (
  value: unknown,
): CheckoutPaymentValidationResult => {
  const cart = asRecord(value);
  if (!cart) {
    throw new CheckoutPaymentValidationError(
      "checkout_money_invalid",
      "The checkout cart snapshot is unavailable.",
    );
  }

  if (!asRecordArray(cart.items).length) {
    throw new CheckoutPaymentValidationError(
      "checkout_cart_empty",
      "The checkout cart must contain at least one item.",
    );
  }
  if (!requiredString(cart.email)) {
    throw new CheckoutPaymentValidationError(
      "checkout_contact_missing",
      "A checkout email address is required.",
    );
  }
  assertAddress(cart.shipping_address);
  if (!asRecordArray(cart.shipping_methods).length) {
    throw new CheckoutPaymentValidationError(
      "checkout_shipping_missing",
      "A delivery method is required.",
    );
  }

  const currencyCode = normalizedString(cart.currency_code);
  if (currencyCode !== CHECKOUT_CURRENCY) {
    throw new CheckoutPaymentValidationError(
      "checkout_currency_invalid",
      "Checkout is configured for USD only.",
    );
  }

  const total = moneyValue(cart.raw_total ?? cart.total, "Cart total");
  if (total.isZero()) {
    return {
      currencyCode,
      paymentSessionStatus: null,
      total: total.toString(),
    };
  }

  const paymentCollection = asRecord(cart.payment_collection);
  if (!paymentCollection) {
    throw new CheckoutPaymentValidationError(
      "checkout_payment_collection_missing",
      "The cart payment collection has not been initialized.",
    );
  }

  const collectionCurrency = normalizedString(
    paymentCollection.currency_code,
  );
  if (collectionCurrency !== currencyCode) {
    throw new CheckoutPaymentValidationError(
      "checkout_payment_currency_mismatch",
      "The payment collection currency does not match the cart.",
    );
  }

  const collectionAmount = amountFrom(
    paymentCollection,
    "Payment collection amount",
  );
  if (!collectionAmount.eq(total)) {
    throw new CheckoutPaymentValidationError(
      "checkout_payment_amount_mismatch",
      "The payment collection amount does not match the cart total.",
    );
  }

  const processableSessions = asRecordArray(
    paymentCollection.payment_sessions,
  ).filter((session) =>
    PROCESSABLE_PAYMENT_STATUSES.has(normalizedString(session.status)),
  );
  if (!processableSessions.length) {
    throw new CheckoutPaymentValidationError(
      "checkout_payment_session_missing",
      "A processable payment session is required.",
    );
  }
  if (processableSessions.length > 1) {
    throw new CheckoutPaymentValidationError(
      "checkout_payment_session_multiple",
      "Only one processable payment session is allowed.",
    );
  }

  const paymentSession = processableSessions[0];
  if (!paymentSession) {
    throw new CheckoutPaymentValidationError(
      "checkout_payment_session_missing",
      "A processable payment session is required.",
    );
  }
  if (normalizedString(paymentSession.provider_id) !== STRIPE_PROVIDER_ID) {
    throw new CheckoutPaymentValidationError(
      "checkout_payment_session_provider_invalid",
      "Positive checkout totals require the configured Stripe provider.",
    );
  }

  const sessionCurrency = normalizedString(paymentSession.currency_code);
  if (sessionCurrency !== currencyCode) {
    throw new CheckoutPaymentValidationError(
      "checkout_payment_currency_mismatch",
      "The payment session currency does not match the cart.",
    );
  }

  const sessionAmount = amountFrom(paymentSession, "Payment session amount");
  if (!sessionAmount.eq(total)) {
    throw new CheckoutPaymentValidationError(
      "checkout_payment_amount_mismatch",
      "The payment session amount does not match the cart total.",
    );
  }

  const paymentIntent = asRecord(paymentSession.data);
  const intentAmount = Number(paymentIntent?.amount);
  if (
    !Number.isSafeInteger(intentAmount) ||
    intentAmount !== payableUsdMinorUnits(total, "Cart total")
  ) {
    throw new CheckoutPaymentValidationError(
      "checkout_payment_amount_mismatch",
      "The Stripe PaymentIntent amount does not match the payable cart total.",
    );
  }
  if (normalizedString(paymentIntent?.currency) !== currencyCode) {
    throw new CheckoutPaymentValidationError(
      "checkout_payment_currency_mismatch",
      "The Stripe PaymentIntent currency does not match the cart.",
    );
  }

  const status = normalizedString(paymentSession.status);
  if (!status) {
    throw new CheckoutPaymentValidationError(
      "checkout_payment_session_invalid",
      "The payment session status is invalid.",
    );
  }

  return {
    currencyCode,
    paymentSessionStatus: status,
    total: total.toString(),
  };
};
