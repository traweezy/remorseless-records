import {
  readFiniteNumber,
  readIsoTimestamp,
} from "../provider-boundary/primitives"
import {
  asUnknownRecord,
  readRecordArray,
  readRequiredRecord,
  type UnknownRecord,
} from "../provider-boundary/records"

const STRIPE_PROVIDER_ID = "pp_stripe_stripe"
const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9]+$/
const CHARGE_ID = /^ch_[A-Za-z0-9]+$/
const ORDER_ID = /^order_[A-Za-z0-9]+$/
const ORDER_NUMBER = /^[1-9]\d{0,19}$/
const MAX_IDENTIFIER_LENGTH = 255
const MAX_IDEMPOTENCY_KEY_LENGTH = 255
const MAX_REFERENCES = 25
const MAX_STATUS_LENGTH = 64

export type StripePaymentReference = {
  amount: number | null
  currencyCode: string | null
  livemode: boolean | null
  paymentIntentId: string
  status: string | null
}

export type StripePaymentProjection =
  | { available: true; references: StripePaymentReference[] }
  | { available: false; references: [] }

export type StripeOrderSyncClient = {
  charges: {
    update: (
      id: string,
      params: {
        description: string
        metadata: Record<string, string>
      },
      options: { idempotencyKey: string }
    ) => Promise<unknown>
  }
  paymentIntents: {
    update: (
      id: string,
      params: {
        description: string
        metadata: Record<string, string>
      },
      options: { idempotencyKey: string }
    ) => Promise<unknown>
  }
}

export class StripeOrderProjectionError extends Error {
  constructor() {
    super("Stripe order payment projection is malformed.")
    this.name = "StripeOrderProjectionError"
  }
}

const projectionError = (): StripeOrderProjectionError =>
  new StripeOrderProjectionError()

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null

const boundedId = (value: unknown, pattern: RegExp): string | null => {
  const parsed = text(value)
  return parsed &&
    parsed.length <= MAX_IDENTIFIER_LENGTH &&
    pattern.test(parsed)
    ? parsed
    : null
}

const optionalText = (
  value: unknown,
  maxLength = MAX_IDENTIFIER_LENGTH
): string | null => {
  if (value === null || value === undefined) {
    return null
  }
  const parsed = text(value)
  if (!parsed || parsed.length > maxLength) {
    throw projectionError()
  }
  return parsed
}

const optionalAmount = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null
  }
  const amount = readFiniteNumber(value)
  if (amount === null || amount < 0) {
    throw projectionError()
  }
  return amount
}

const optionalCurrency = (value: unknown): string | null => {
  const currency = optionalText(value)?.toLowerCase() ?? null
  if (currency !== null && !/^[a-z]{3}$/.test(currency)) {
    throw projectionError()
  }
  return currency
}

const optionalLivemode = (value: unknown): boolean | null => {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== "boolean") {
    throw projectionError()
  }
  return value
}

const projectionRecords = (
  value: unknown,
  context: string
): UnknownRecord[] => {
  try {
    return readRecordArray(value, { context, optional: true })
  } catch {
    throw projectionError()
  }
}

type PaymentCandidate = {
  record: UnknownRecord
  settled: boolean
}

const settledFrom = (payment: UnknownRecord): boolean => {
  const timestamps = [payment.captured_at, payment.authorized_at]
  let settled = false
  for (const value of timestamps) {
    if (value === null || value === undefined) {
      continue
    }
    if (!readIsoTimestamp(value)) {
      throw projectionError()
    }
    settled = true
  }
  return settled
}

const paymentCandidatesFromOrder = (order: unknown): PaymentCandidate[] => {
  let orderRecord: UnknownRecord
  try {
    orderRecord = readRequiredRecord(order, "Stripe order projection")
  } catch {
    throw projectionError()
  }
  return projectionRecords(
    orderRecord.payment_collections,
    "Stripe order payment-collection projection"
  ).flatMap((collection) => [
    ...projectionRecords(
      collection.payments,
      "Stripe order payment projection"
    ).map((record) => ({ record, settled: settledFrom(record) })),
    ...projectionRecords(
      collection.payment_sessions,
      "Stripe order payment-session projection"
    ).map((record) => ({ record, settled: false })),
  ])
}

export const orderUsesStripe = (order: unknown): boolean =>
  paymentCandidatesFromOrder(order).some(
    ({ record }) =>
      optionalText(record.provider_id, MAX_IDENTIFIER_LENGTH) ===
      STRIPE_PROVIDER_ID
  )

const paymentReference = (
  payment: UnknownRecord
): StripePaymentReference | null => {
  if (
    optionalText(payment.provider_id, MAX_IDENTIFIER_LENGTH) !==
    STRIPE_PROVIDER_ID
  ) {
    return null
  }

  const data = asUnknownRecord(payment.data)
  const paymentIntentId = boundedId(data?.id, PAYMENT_INTENT_ID)
  if (!data || !paymentIntentId) {
    throw projectionError()
  }

  const amountValue =
    payment.amount === null || payment.amount === undefined
      ? data.amount
      : payment.amount
  const currencyValue =
    payment.currency_code === null || payment.currency_code === undefined
      ? data.currency
      : payment.currency_code

  return {
    amount: optionalAmount(amountValue),
    currencyCode: optionalCurrency(currencyValue),
    livemode: optionalLivemode(data.livemode),
    paymentIntentId,
    status:
      optionalText(data.status, MAX_STATUS_LENGTH) ??
      optionalText(payment.status, MAX_STATUS_LENGTH),
  }
}

const referencesAgree = (
  left: StripePaymentReference,
  right: StripePaymentReference
): boolean =>
  (left.amount === null ||
    right.amount === null ||
    left.amount === right.amount) &&
  (left.currencyCode === null ||
    right.currencyCode === null ||
    left.currencyCode === right.currencyCode) &&
  (left.livemode === null ||
    right.livemode === null ||
    left.livemode === right.livemode)

export const stripePaymentReferencesFromOrder = (
  order: unknown
): StripePaymentReference[] => {
  const references = new Map<
    string,
    { reference: StripePaymentReference; settled: boolean }
  >()
  for (const candidate of paymentCandidatesFromOrder(order)) {
    const reference = paymentReference(candidate.record)
    if (!reference) {
      continue
    }
    const current = references.get(reference.paymentIntentId)
    if (current && !referencesAgree(current.reference, reference)) {
      throw projectionError()
    }
    if (current?.settled && candidate.settled) {
      throw projectionError()
    }
    if (!current || candidate.settled) {
      references.set(reference.paymentIntentId, {
        reference,
        settled: candidate.settled,
      })
    }
  }
  return [...references.values()].map(({ reference }) => reference)
}

export const inspectStripePaymentReferencesFromOrder = (
  order: unknown
): StripePaymentProjection => {
  try {
    return {
      available: true,
      references: stripePaymentReferencesFromOrder(order),
    }
  } catch (error) {
    if (error instanceof StripeOrderProjectionError) {
      return { available: false, references: [] }
    }
    throw error
  }
}

export const stripeOrderMetadata = ({
  orderId,
  orderNumber,
}: {
  orderId: string
  orderNumber: string
}): Record<string, string> => ({
  commerce_platform: "medusa",
  medusa_order_id: orderId,
  medusa_order_number: orderNumber,
  storefront: "remorseless-records",
})

export const stripeOrderDescription = (orderNumber: string): string =>
  `Remorseless Records order #${orderNumber}`

const assertSyncInput = ({
  orderId,
  orderNumber,
  references,
}: {
  orderId: string
  orderNumber: string
  references: StripePaymentReference[]
}): void => {
  const ids = new Set<string>()
  if (
    !boundedId(orderId, ORDER_ID) ||
    typeof orderNumber !== "string" ||
    !ORDER_NUMBER.test(orderNumber) ||
    !Array.isArray(references) ||
    references.length < 1 ||
    references.length > MAX_REFERENCES
  ) {
    throw new Error("Stripe order sync input is invalid.")
  }
  for (const reference of references) {
    const referenceRecord = asUnknownRecord(reference)
    const paymentIntentId = boundedId(
      referenceRecord?.paymentIntentId,
      PAYMENT_INTENT_ID
    )
    if (!paymentIntentId) {
      throw new Error("Stripe order sync input is invalid.")
    }
    const idempotencyPrefix = `rr-order-sync:${orderId}:${paymentIntentId}`
    if (
      ids.has(paymentIntentId) ||
      `${idempotencyPrefix}:intent:v1`.length > MAX_IDEMPOTENCY_KEY_LENGTH ||
      `${idempotencyPrefix}:charge:v1`.length > MAX_IDEMPOTENCY_KEY_LENGTH
    ) {
      throw new Error("Stripe order sync input is invalid.")
    }
    ids.add(paymentIntentId)
  }
}

const chargeIdFrom = (
  value: unknown,
  paymentIntentId: string
): string | null => {
  const paymentIntent = asUnknownRecord(value)
  if (
    paymentIntent?.object !== "payment_intent" ||
    paymentIntent.id !== paymentIntentId ||
    !Object.hasOwn(paymentIntent, "latest_charge")
  ) {
    throw new Error("Stripe order sync acknowledgement is invalid.")
  }
  const latestCharge = paymentIntent.latest_charge
  if (latestCharge === null || latestCharge === undefined) {
    return null
  }
  const chargeId =
    typeof latestCharge === "string"
      ? latestCharge
      : asUnknownRecord(latestCharge)?.id
  const parsedChargeId = boundedId(chargeId, CHARGE_ID)
  if (!parsedChargeId) {
    throw new Error("Stripe order sync acknowledgement is invalid.")
  }
  return parsedChargeId
}

const assertChargeAcknowledgement = (
  value: unknown,
  chargeId: string
): void => {
  const charge = asUnknownRecord(value)
  if (charge?.object !== "charge" || charge.id !== chargeId) {
    throw new Error("Stripe order sync acknowledgement is invalid.")
  }
}

export const syncStripeOrderReferences = async ({
  client,
  orderId,
  orderNumber,
  references,
}: {
  client: StripeOrderSyncClient
  orderId: string
  orderNumber: string
  references: StripePaymentReference[]
}): Promise<number> => {
  assertSyncInput({ orderId, orderNumber, references })
  const metadata = stripeOrderMetadata({ orderId, orderNumber })
  const description = stripeOrderDescription(orderNumber)

  for (const reference of references) {
    const idempotencyPrefix = `rr-order-sync:${orderId}:${reference.paymentIntentId}`
    const paymentIntent = await client.paymentIntents.update(
      reference.paymentIntentId,
      { description, metadata },
      { idempotencyKey: `${idempotencyPrefix}:intent:v1` }
    )
    const chargeId = chargeIdFrom(paymentIntent, reference.paymentIntentId)
    if (chargeId) {
      const charge = await client.charges.update(
        chargeId,
        { description, metadata },
        { idempotencyKey: `${idempotencyPrefix}:charge:v1` }
      )
      assertChargeAcknowledgement(charge, chargeId)
    }
  }

  return references.length
}

export const stripeDashboardPaymentUrl = (
  reference: StripePaymentReference
): string | null =>
  reference.livemode === null ||
  !boundedId(reference.paymentIntentId, PAYMENT_INTENT_ID)
    ? null
    : `https://dashboard.stripe.com/${
        reference.livemode ? "" : "test/"
      }payments/${reference.paymentIntentId}`
