import { MathBN, MedusaError } from "@medusajs/framework/utils"

import { validateCheckoutPayment } from "../checkout/payment-validation"
import {
  asUnknownRecord as asRecord,
  readRecordArray,
  readRequiredRecord,
  type UnknownRecord,
} from "../provider-boundary/records"
import { taxQuoteIdentityFromCart } from "./quote"
import {
  StripePaymentBindingClientError,
  type StripePaymentBindingClient,
  type StripePaymentBindingResult,
  type StripePaymentBindingRetryEvent,
  verifyAndLinkStripePayment,
} from "./stripe-payment-binding-client"
import type TaxControlModuleService from "../../modules/tax-control/service"
import {
  taxQuoteEvidenceFrom,
  taxQuoteEvidenceListFrom,
  type TaxQuoteEvidenceRecord,
} from "../../modules/tax-control/persistence-contracts"

const PROCESSABLE_SESSION_STATUSES = new Set([
  "authorized",
  "captured",
  "pending",
  "pending_authorization",
  "requires_more",
])

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : ""

const taxEvidenceFrom = (
  value: unknown,
  context: string
): TaxQuoteEvidenceRecord | null => {
  try {
    return (
      taxQuoteEvidenceListFrom(
        value,
        1,
        `${context} returned invalid stored state.`
      ).at(0) ?? null
    )
  } catch {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Tax evidence returned an ambiguous result or invalid stored state."
    )
  }
}

const minorUnits = (value: string): number => {
  const amount = Math.round(MathBN.mult(value, 100).toNumber())
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The payable tax-bound amount is invalid."
    )
  }
  return amount
}

const paymentSessionFrom = (cart: UnknownRecord): UnknownRecord => {
  const collection = asRecord(cart.payment_collection)
  let allSessions: UnknownRecord[]
  try {
    allSessions = readRecordArray(collection?.payment_sessions, {
      context: "Tax binding payment-session query",
      optional: true,
    })
  } catch {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The Stripe payment-session snapshot is malformed."
    )
  }
  const sessions = allSessions.filter(
    (session) =>
      text(session.provider_id) === "pp_stripe_stripe" &&
      PROCESSABLE_SESSION_STATUSES.has(text(session.status))
  )
  const [session] = sessions
  if (sessions.length !== 1 || !session) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Exactly one pending Stripe payment session is required."
    )
  }
  return session
}

const paymentBindingError = (error: StripePaymentBindingClientError) => {
  const details: Partial<
    Record<StripePaymentBindingClientError["code"], string>
  > = {
    calculation_mismatch:
      "The Stripe Tax calculation does not match the payable Medusa cart.",
    hook_conflict:
      "The PaymentIntent is linked to a different Stripe Tax calculation.",
    not_linkable: "The PaymentIntent can no longer be linked safely.",
    payment_mismatch:
      "The Stripe PaymentIntent amount or currency does not match Medusa.",
    tax_identity_mismatch:
      "Stripe returned a PaymentIntent with a different tax identity.",
  }
  const detail = details[error.code]
  return new MedusaError(
    detail ? MedusaError.Types.CONFLICT : MedusaError.Types.UNEXPECTED_STATE,
    detail ?? "Stripe payment binding could not be verified. Try again."
  )
}

export type BindCheckoutTaxResult = {
  collectionMode: "collect" | "disabled"
  generation: number
  provider: "stripe_tax" | "taxrate_io" | null
  replayed: boolean
}

export const bindCheckoutTaxToPayment = async ({
  cart,
  client,
  onRetry,
  service,
  timeoutMs = 8_000,
}: {
  cart: unknown
  client: StripePaymentBindingClient
  onRetry?: (event: StripePaymentBindingRetryEvent) => void
  service: TaxControlModuleService
  timeoutMs?: number
}): Promise<BindCheckoutTaxResult> => {
  const cartRecord = asRecord(cart)
  const cartId = text(cartRecord?.id)
  if (!cartRecord || !/^cart_[A-Za-z0-9]+$/.test(cartId)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The tax binding cart is invalid."
    )
  }

  const validation = validateCheckoutPayment(cartRecord)
  const amountMinor = minorUnits(validation.total)
  const quote = taxQuoteIdentityFromCart(cartRecord)
  const session = paymentSessionFrom(cartRecord)
  const sessionData = asRecord(session.data)
  const paymentIntentId = text(sessionData?.id)
  if (!/^pi_[A-Za-z0-9]+$/.test(paymentIntentId)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The Stripe PaymentIntent identity is unavailable."
    )
  }

  const existingEvidenceResult: unknown = await service.listTaxQuoteEvidences(
    { payment_intent_id: paymentIntentId },
    { take: 2 }
  )
  const existingEvidence = taxEvidenceFrom(
    existingEvidenceResult,
    "PaymentIntent tax evidence query"
  )
  if (quote.calculationId) {
    const calculationEvidenceResult: unknown =
      await service.listTaxQuoteEvidences(
        { calculation_id: quote.calculationId },
        { take: 2 }
      )
    const calculationEvidence = taxEvidenceFrom(
      calculationEvidenceResult,
      "Calculation tax evidence query"
    )
    if (
      calculationEvidence &&
      calculationEvidence.payment_intent_id !== paymentIntentId
    ) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "The Stripe Tax calculation is already bound to another PaymentIntent."
      )
    }
  }

  let binding: StripePaymentBindingResult
  try {
    binding = await verifyAndLinkStripePayment({
      amountMinor,
      calculationId: quote.calculationId,
      cartId,
      client,
      collectionMode: quote.collectionMode,
      currencyCode: validation.currencyCode,
      fingerprint: quote.fingerprint,
      generation: quote.generation,
      ...(onRetry ? { onRetry } : {}),
      paymentIntentId,
      provider: quote.provider,
      taxRatePercent: quote.taxRatePercent,
      timeoutMs,
    })
  } catch (error) {
    throw error instanceof StripePaymentBindingClientError
      ? paymentBindingError(error)
      : error
  }

  const recordedResult: unknown = await service.recordTaxQuoteEvidence({
    amountMinor,
    calculationId: quote.calculationId,
    cartId,
    collectionMode: quote.collectionMode,
    currencyCode: validation.currencyCode,
    fingerprint: quote.fingerprint,
    generation: quote.generation,
    paymentIntentId,
    provider: quote.provider,
    status: binding.status === "succeeded" ? "succeeded" : "prepared",
  })
  let recorded: UnknownRecord
  try {
    recorded = readRequiredRecord(
      recordedResult,
      "Recorded tax evidence result"
    )
  } catch {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Tax evidence persistence returned an invalid result."
    )
  }
  let persistedEvidence: TaxQuoteEvidenceRecord
  try {
    persistedEvidence = taxQuoteEvidenceFrom(recorded.evidence)
  } catch {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Tax evidence persistence returned an invalid result."
    )
  }
  if (
    typeof recorded.replayed !== "boolean" ||
    persistedEvidence.amount_minor !== amountMinor ||
    persistedEvidence.calculation_id !== quote.calculationId ||
    persistedEvidence.cart_id !== cartId ||
    persistedEvidence.collection_mode !== quote.collectionMode ||
    persistedEvidence.currency_code !== validation.currencyCode ||
    persistedEvidence.fingerprint !== quote.fingerprint ||
    persistedEvidence.generation !== quote.generation ||
    persistedEvidence.payment_intent_id !== paymentIntentId ||
    persistedEvidence.provider !== quote.provider
  ) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Tax evidence persistence returned an invalid result."
    )
  }

  return {
    collectionMode: quote.collectionMode,
    generation: quote.generation,
    provider: quote.provider,
    replayed:
      Boolean(existingEvidence) ||
      recorded.replayed ||
      binding.previouslyLinked,
  }
}
