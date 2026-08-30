const STRIPE_PROVIDER_ID = "pp_stripe_stripe"
const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9]+$/

type UnknownRecord = Record<string, unknown>

export type StripePaymentReference = {
  amount: number | null
  currencyCode: string | null
  livemode: boolean
  paymentIntentId: string
  status: string | null
}

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
    ) => Promise<{ latest_charge?: string | { id: string } | null }>
  }
}

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null

const finiteNumber = (value: unknown): number | null => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const records = (value: unknown): UnknownRecord[] =>
  Array.isArray(value)
    ? value
        .map(asRecord)
        .filter((entry): entry is UnknownRecord => entry !== null)
    : []

const paymentCandidatesFromOrder = (order: unknown): UnknownRecord[] => {
  const orderRecord = asRecord(order)
  return records(orderRecord?.payment_collections).flatMap((collection) => [
    ...records(collection.payments),
    ...records(collection.payment_sessions),
  ])
}

export const orderUsesStripe = (order: unknown): boolean =>
  paymentCandidatesFromOrder(order).some(
    (candidate) => text(candidate.provider_id) === STRIPE_PROVIDER_ID
  )

const paymentReference = (
  payment: UnknownRecord
): StripePaymentReference | null => {
  if (text(payment.provider_id) !== STRIPE_PROVIDER_ID) {
    return null
  }

  const data = asRecord(payment.data)
  const paymentIntentId = text(data?.id)
  if (!paymentIntentId || !PAYMENT_INTENT_ID.test(paymentIntentId)) {
    return null
  }

  return {
    amount: finiteNumber(payment.amount ?? data?.amount),
    currencyCode:
      text(payment.currency_code)?.toLowerCase() ??
      text(data?.currency)?.toLowerCase() ??
      null,
    livemode: data?.livemode === true,
    paymentIntentId,
    status: text(data?.status) ?? text(payment.status),
  }
}

export const stripePaymentReferencesFromOrder = (
  order: unknown
): StripePaymentReference[] => {
  const references = new Map<string, StripePaymentReference>()
  for (const candidate of paymentCandidatesFromOrder(order)) {
    const reference = paymentReference(candidate)
    if (!reference) {
      continue
    }
    const current = references.get(reference.paymentIntentId)
    if (!current || candidate.captured_at || candidate.authorized_at) {
      references.set(reference.paymentIntentId, reference)
    }
  }
  return [...references.values()]
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

const chargeIdFrom = (
  latestCharge: string | { id: string } | null | undefined
): string | null =>
  typeof latestCharge === "string" ? latestCharge : (latestCharge?.id ?? null)

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
  const metadata = stripeOrderMetadata({ orderId, orderNumber })
  const description = stripeOrderDescription(orderNumber)

  for (const reference of references) {
    const idempotencyPrefix = `rr-order-sync:${orderId}:${reference.paymentIntentId}`
    const paymentIntent = await client.paymentIntents.update(
      reference.paymentIntentId,
      { description, metadata },
      { idempotencyKey: `${idempotencyPrefix}:intent:v1` }
    )
    const chargeId = chargeIdFrom(paymentIntent.latest_charge)
    if (chargeId) {
      await client.charges.update(
        chargeId,
        { description, metadata },
        { idempotencyKey: `${idempotencyPrefix}:charge:v1` }
      )
    }
  }

  return references.length
}

export const stripeDashboardPaymentUrl = (
  reference: StripePaymentReference
): string =>
  `https://dashboard.stripe.com/${reference.livemode ? "" : "test/"}payments/${
    reference.paymentIntentId
  }`
