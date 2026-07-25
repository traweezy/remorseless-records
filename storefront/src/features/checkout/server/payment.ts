import "server-only"

import type { HttpTypes } from "@medusajs/types"

const STRIPE_PROVIDER_ID = "pp_stripe_stripe"
const REUSABLE_PAYMENT_STATUSES = new Set(["pending", "requires_more"])
const FINALIZING_PAYMENT_STATUSES = new Set(["authorized", "captured"])
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

const exactUsdAmount = (value: unknown, name: string): number => {
  const parsed = Number(value)
  if (
    !Number.isFinite(parsed) ||
    parsed < 0 ||
    Math.round(parsed * 100) / 100 !== parsed
  ) {
    throw new CheckoutPaymentError(
      "payment_session_stale",
      `${name} is not a valid USD amount.`
    )
  }
  return parsed
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
  const total = exactUsdAmount(cart.total, "Cart total")
  if (total === 0) {
    return null
  }
  if (normalizedCurrency(cart.currency_code) !== "usd") {
    throw new CheckoutPaymentError(
      "payment_session_stale",
      "Checkout is configured for USD only."
    )
  }

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
    exactUsdAmount(paymentCollection.amount, "Payment collection amount") !==
    total
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
    throw new CheckoutPaymentError(
      "payment_session_stale",
      "More than one reusable Stripe payment session exists."
    )
  }

  const session = sessions[0]
  if (!session) {
    return null
  }
  if (normalizedCurrency(session.currency_code) !== "usd") {
    throw new CheckoutPaymentError(
      "payment_session_stale",
      "The payment session currency changed."
    )
  }
  if (exactUsdAmount(session.amount, "Payment session amount") !== total) {
    throw new CheckoutPaymentError(
      "payment_session_stale",
      "The payment session amount changed."
    )
  }
  const clientSecret = clientSecretFrom(session)
  if (!clientSecret) {
    throw new CheckoutPaymentError(
      "payment_not_configured",
      "Stripe did not return a client secret."
    )
  }

  return {
    clientSecret,
    status: session.status,
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
  const total = exactUsdAmount(cart.total, "Cart total")
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
    exactUsdAmount(paymentCollection.amount, "Payment collection amount") !==
    total
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
  if (exactUsdAmount(session.amount, "Payment session amount") !== total) {
    throw new CheckoutPaymentError(
      "payment_session_stale",
      "The payment session amount changed."
    )
  }

  return { status: session.status }
}
