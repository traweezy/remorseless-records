import type Stripe from "stripe"

import {
  stripeLifecycleEventTypes,
  type StripeLifecycleEventType,
} from "../../modules/payment-lifecycle/constants"
import {
  recordStripeLifecycleEventInputFrom,
  type RecordStripeLifecycleEventInput,
} from "./contracts"

type UnknownRecord = Record<string, unknown>

const supportedTypes = new Set<string>(stripeLifecycleEventTypes)
const eventIdPattern = /^evt_[A-Za-z0-9]+$/
const paymentIntentIdPattern = /^pi_[A-Za-z0-9]+$/
const chargeIdPattern = /^ch_[A-Za-z0-9]+$/
const refundIdPattern = /^re_[A-Za-z0-9]+$/
const disputeIdPattern = /^du_[A-Za-z0-9]+$/

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null

const expandableId = (value: unknown, pattern: RegExp): string | null => {
  if (value === null || value === undefined) {
    return null
  }
  const candidate = typeof value === "string" ? value : asRecord(value)?.id
  if (typeof candidate !== "string" || !pattern.test(candidate)) {
    throw new Error("Stripe lifecycle event reference is invalid.")
  }
  return candidate
}

const currencyCode = (value: unknown): unknown =>
  typeof value === "string" && /^[a-zA-Z]{3}$/.test(value.trim())
    ? value.trim().toLowerCase()
    : value

const providerStatus = (value: unknown): string | null =>
  value === null || value === undefined
    ? null
    : typeof value === "string" && /^[a-z_]{2,64}$/.test(value)
      ? value
      : (() => {
          throw new Error("Stripe lifecycle event status is invalid.")
        })()

const objectIdPattern = (eventType: StripeLifecycleEventType): RegExp =>
  eventType.startsWith("refund.") ? refundIdPattern : disputeIdPattern

export const projectStripeLifecycleEvent = (
  event: Stripe.Event
): RecordStripeLifecycleEventInput | null => {
  if (!supportedTypes.has(event.type)) {
    return null
  }
  const eventType = event.type as StripeLifecycleEventType
  const object = asRecord(event.data.object)
  const providerEventId =
    typeof event.id === "string" && eventIdPattern.test(event.id)
      ? event.id
      : null
  const objectId =
    typeof object?.id === "string" && objectIdPattern(eventType).test(object.id)
      ? object.id
      : null
  if (
    !object ||
    !providerEventId ||
    !objectId ||
    !Number.isSafeInteger(event.created) ||
    event.created < 0
  ) {
    throw new Error("Stripe lifecycle event identity is invalid.")
  }

  return recordStripeLifecycleEventInputFrom({
    amountMinor: object.amount,
    chargeId: expandableId(object.charge, chargeIdPattern),
    currencyCode: currencyCode(object.currency),
    eventCreatedAt: new Date(event.created * 1_000),
    eventType,
    livemode: event.livemode,
    objectId,
    paymentIntentId: expandableId(
      object.payment_intent,
      paymentIntentIdPattern
    ),
    providerEventId,
    providerObjectStatus: providerStatus(object.status),
  })
}
