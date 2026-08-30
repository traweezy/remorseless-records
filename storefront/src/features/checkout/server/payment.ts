import "server-only"

import type { HttpTypes } from "@medusajs/types"

import {
  TaxQuoteIdentityError,
  taxQuoteIdentityFromCart,
} from "@/lib/cart/tax-quote"

const STRIPE_PROVIDER_ID = "pp_stripe_stripe"
const STRIPE_MIN_USD_AMOUNT = 50
const STRIPE_MAX_USD_AMOUNT = 99_999_999
const REUSABLE_PAYMENT_STATUSES = new Set(["pending", "requires_more"])
const FINALIZING_PAYMENT_STATUSES = new Set([
  "authorized",
  "captured",
  "pending_authorization",
])
const COMPLETABLE_PAYMENT_STATUSES = new Set([
  "pending",
  "requires_more",
  "authorized",
  "captured",
  "pending_authorization",
])

export type PreparedPayment = {
  clientSecret: string
  status: string
}

export class CheckoutPaymentError extends Error {
  readonly code:
    | "payment_not_configured"
    | "payment_result_unknown"
    | "payment_session_stale"

  constructor(code: CheckoutPaymentError["code"], message: string) {
    super(message)
    this.name = "CheckoutPaymentError"
    this.code = code
  }
}

const normalizedCurrency = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase() : ""

const usdAmount = (value: unknown, name: string): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new CheckoutPaymentError(
      "payment_session_stale",
      `${name} is not a valid USD amount.`
    )
  }
  return parsed
}

const payableUsdMinorUnits = (value: number, name: string): number => {
  const roundingGuard = Number.EPSILON * Math.max(1, value)
  const minorUnits = Math.round((value + roundingGuard) * 100)
  if (
    !Number.isSafeInteger(minorUnits) ||
    minorUnits < STRIPE_MIN_USD_AMOUNT ||
    minorUnits > STRIPE_MAX_USD_AMOUNT
  ) {
    throw new CheckoutPaymentError(
      "payment_session_stale",
      `${name} is outside Stripe's supported USD amount range.`
    )
  }
  return minorUnits
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null

const assertStripeIntentAmount = (
  session: HttpTypes.StorePaymentSession,
  total: number
): void => {
  const data = asRecord(session.data)
  const intentAmount = Number(data?.amount)
  const intentCurrency =
    typeof data?.currency === "string" ? data.currency.trim().toLowerCase() : ""
  if (
    !Number.isSafeInteger(intentAmount) ||
    intentAmount !== payableUsdMinorUnits(total, "Cart total")
  ) {
    throw new CheckoutPaymentError(
      "payment_session_stale",
      "The Stripe PaymentIntent amount changed."
    )
  }
  if (intentCurrency !== "usd") {
    throw new CheckoutPaymentError(
      "payment_session_stale",
      "The Stripe PaymentIntent currency changed."
    )
  }
}

const assertTaxQuoteIdentity = (
  cart: HttpTypes.StoreCart,
  session: HttpTypes.StorePaymentSession
): void => {
  let quote: ReturnType<typeof taxQuoteIdentityFromCart>
  try {
    quote = taxQuoteIdentityFromCart(cart)
  } catch (error: unknown) {
    if (error instanceof TaxQuoteIdentityError) {
      throw new CheckoutPaymentError("payment_session_stale", error.message)
    }
    throw error
  }

  const data = asRecord(session.data)
  const metadata = asRecord(data?.metadata)
  const generation = Number(metadata?.rr_tax_generation)
  const calculationId =
    typeof metadata?.rr_tax_calculation_id === "string"
      ? metadata.rr_tax_calculation_id.trim()
      : ""
  if (
    metadata?.rr_tax_provider !== quote.provider ||
    !Number.isSafeInteger(generation) ||
    generation !== quote.generation ||
    metadata?.rr_tax_fingerprint !== quote.fingerprint ||
    (quote.calculationId ?? "") !== calculationId
  ) {
    throw new CheckoutPaymentError(
      "payment_session_stale",
      "The payment session tax quote changed."
    )
  }

  if (quote.provider === "taxrate_io") {
    const rate = Number(metadata?.rr_tax_rate_percent)
    if (!Number.isFinite(rate) || rate < 0 || rate !== quote.taxRatePercent) {
      throw new CheckoutPaymentError(
        "payment_session_stale",
        "The payment session tax rate changed."
      )
    }
  }
}

const clientSecretFrom = (
  session: HttpTypes.StorePaymentSession
): string | null => {
  if (!session.data || typeof session.data !== "object") {
    return null
  }
  const value = session.data.client_secret
  return typeof value === "string" && value.trim() ? value : null
}

const stripeSessions = (
  cart: HttpTypes.StoreCart
): HttpTypes.StorePaymentSession[] =>
  (cart.payment_collection?.payment_sessions ?? []).filter(
    (session) => session.provider_id === STRIPE_PROVIDER_ID
  )

export const paymentNeedsFinalization = (cart: HttpTypes.StoreCart): boolean =>
  stripeSessions(cart).some((session) =>
    FINALIZING_PAYMENT_STATUSES.has(session.status)
  )

export const reusablePreparedPayment = (
  cart: HttpTypes.StoreCart
): PreparedPayment | null => {
  const total = usdAmount(cart.total, "Cart total")
  if (total === 0) {
    return null
  }
  if (normalizedCurrency(cart.currency_code) !== "usd") {
    throw new CheckoutPaymentError(
      "payment_session_stale",
      "Checkout is configured for USD only."
    )
  }
  payableUsdMinorUnits(total, "Cart total")

  const paymentCollection = cart.payment_collection
  if (!paymentCollection) {
    return null
  }
  if (normalizedCurrency(paymentCollection.currency_code) !== "usd") {
    throw new CheckoutPaymentError(
      "payment_session_stale",
      "The payment collection currency changed."
    )
  }
  if (
    usdAmount(paymentCollection.amount, "Payment collection amount") !== total
  ) {
    throw new CheckoutPaymentError(
      "payment_session_stale",
      "The payment collection amount changed."
    )
  }

  const sessions = stripeSessions(cart).filter((session) =>
    REUSABLE_PAYMENT_STATUSES.has(session.status)
  )
  if (!sessions.length) {
    return null
  }
  if (sessions.length !== 1) {
    return null
  }

  const session = sessions[0]
  if (!session) {
    return null
  }
  try {
    if (normalizedCurrency(session.currency_code) !== "usd") {
      return null
    }
    if (usdAmount(session.amount, "Payment session amount") !== total) {
      return null
    }
    assertStripeIntentAmount(session, total)
    assertTaxQuoteIdentity(cart, session)
    const clientSecret = clientSecretFrom(session)
    if (!clientSecret) {
      return null
    }

    return {
      clientSecret,
      status: session.status,
    }
  } catch (error: unknown) {
    if (
      error instanceof CheckoutPaymentError &&
      error.code !== "payment_result_unknown"
    ) {
      return null
    }
    throw error
  }
}

export const assertPreparedPayment = (
  cart: HttpTypes.StoreCart
): PreparedPayment => {
  if (paymentNeedsFinalization(cart)) {
    throw new CheckoutPaymentError(
      "payment_result_unknown",
      "The existing payment must be finalized before another attempt."
    )
  }
  const prepared = reusablePreparedPayment(cart)
  if (!prepared) {
    throw new CheckoutPaymentError(
      "payment_not_configured",
      "A reusable Stripe payment session is unavailable."
    )
  }
  return prepared
}

export const assertCompletablePayment = (
  cart: HttpTypes.StoreCart
): { status: string } => {
  const total = usdAmount(cart.total, "Cart total")
  if (total <= 0) {
    throw new CheckoutPaymentError(
      "payment_session_stale",
      "A positive checkout total is required for Stripe."
    )
  }
  if (normalizedCurrency(cart.currency_code) !== "usd") {
    throw new CheckoutPaymentError(
      "payment_session_stale",
      "Checkout is configured for USD only."
    )
  }

  const paymentCollection = cart.payment_collection
  if (!paymentCollection) {
    throw new CheckoutPaymentError(
      "payment_not_configured",
      "The checkout payment collection is unavailable."
    )
  }
  if (normalizedCurrency(paymentCollection.currency_code) !== "usd") {
    throw new CheckoutPaymentError(
      "payment_session_stale",
      "The payment collection currency changed."
    )
  }
  if (
    usdAmount(paymentCollection.amount, "Payment collection amount") !== total
  ) {
    throw new CheckoutPaymentError(
      "payment_session_stale",
      "The payment collection amount changed."
    )
  }

  const processable = stripeSessions(cart).filter((session) =>
    COMPLETABLE_PAYMENT_STATUSES.has(session.status)
  )
  if (processable.length !== 1) {
    throw new CheckoutPaymentError(
      "payment_session_stale",
      "Checkout requires exactly one processable Stripe payment."
    )
  }

  const session = processable[0]
  if (!session) {
    throw new CheckoutPaymentError(
      "payment_not_configured",
      "The Stripe payment session is unavailable."
    )
  }
  if (normalizedCurrency(session.currency_code) !== "usd") {
    throw new CheckoutPaymentError(
      "payment_session_stale",
      "The payment session currency changed."
    )
  }
  if (usdAmount(session.amount, "Payment session amount") !== total) {
    throw new CheckoutPaymentError(
      "payment_session_stale",
      "The payment session amount changed."
    )
  }
  assertStripeIntentAmount(session, total)
  assertTaxQuoteIdentity(cart, session)

  return { status: session.status }
}
