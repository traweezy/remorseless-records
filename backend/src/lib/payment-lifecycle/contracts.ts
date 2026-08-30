import {
  stripeLifecycleEventStatuses,
  stripeLifecycleEventTypes,
  type StripeLifecycleEventStatus,
  type StripeLifecycleEventType,
} from "../../modules/payment-lifecycle/constants"
import { taxQuoteEvidenceStatuses } from "../../modules/tax-control/constants"
import {
  asUnknownRecord,
  type UnknownRecord,
} from "../provider-boundary/records"
import { readIsoTimestamp } from "../provider-boundary/primitives"

const eventIdPattern = /^evt_[A-Za-z0-9]+$/
const lifecycleEventIdPattern = /^stripelinevt_[A-Za-z0-9]+$/
const paymentIntentIdPattern = /^pi_[A-Za-z0-9]+$/
const chargeIdPattern = /^ch_[A-Za-z0-9]+$/
const refundIdPattern = /^re_[A-Za-z0-9]+$/
const disputeIdPattern = /^du_[A-Za-z0-9]+$/
const orderIdPattern = /^order_[A-Za-z0-9]+$/
const providerStatusPattern = /^[a-z_]{2,64}$/
const errorCodePattern = /^[a-z0-9_]{3,64}$/
const associationStatusPattern = /^[a-z0-9_:,.-]{2,512}$/
const MAX_LIFECYCLE_AMOUNT_MINOR = 99_999_999
const MAX_LIFECYCLE_ATTEMPTS = 1_000

const lifecycleDataError = (): TypeError =>
  new TypeError("Stripe lifecycle data is malformed.")

const requiredIdentifier = (value: unknown, pattern: RegExp): string => {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw lifecycleDataError()
  }
  return value
}

const nullableIdentifier = (value: unknown, pattern: RegExp): string | null => {
  if (value === null) {
    return null
  }
  return requiredIdentifier(value, pattern)
}

const optionalIdentifier = (
  value: unknown,
  pattern: RegExp
): string | undefined => {
  if (value === undefined) {
    return undefined
  }
  return requiredIdentifier(value, pattern)
}

const requiredDate = (value: unknown): Date => {
  const normalized = readIsoTimestamp(value)
  if (!normalized) {
    throw lifecycleDataError()
  }
  return new Date(normalized)
}

const nullableDate = (value: unknown): Date | null =>
  value === null ? null : requiredDate(value)

const requiredAmountMinor = (value: unknown): number => {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_LIFECYCLE_AMOUNT_MINOR
  ) {
    throw lifecycleDataError()
  }
  return value
}

const nullableAmountMinor = (value: unknown): number | null =>
  value === null ? null : requiredAmountMinor(value)

const eventTypeFrom = (value: unknown): StripeLifecycleEventType => {
  if (
    typeof value !== "string" ||
    !stripeLifecycleEventTypes.includes(value as StripeLifecycleEventType)
  ) {
    throw lifecycleDataError()
  }
  return value as StripeLifecycleEventType
}

const eventStatusFrom = (value: unknown): StripeLifecycleEventStatus => {
  if (
    typeof value !== "string" ||
    !stripeLifecycleEventStatuses.includes(value as StripeLifecycleEventStatus)
  ) {
    throw lifecycleDataError()
  }
  return value as StripeLifecycleEventStatus
}

const objectIdFrom = (
  value: unknown,
  eventType: StripeLifecycleEventType
): string =>
  requiredIdentifier(
    value,
    eventType.startsWith("refund.") ? refundIdPattern : disputeIdPattern
  )

const nullableProviderStatus = (value: unknown): string | null =>
  value === null ? null : requiredIdentifier(value, providerStatusPattern)

export type RecordStripeLifecycleEventInput = {
  amountMinor: number
  chargeId: string | null
  currencyCode: "usd"
  eventCreatedAt: Date
  eventType: StripeLifecycleEventType
  livemode: boolean
  objectId: string
  paymentIntentId: string | null
  providerEventId: string
  providerObjectStatus: string | null
}

export type CompleteStripeLifecycleEventInput = {
  id: string
  metadata: UnknownRecord
  orderId?: string
  providerObjectStatus: string | null
  status: Extract<StripeLifecycleEventStatus, "ignored" | "processed">
}

export type StripeLifecycleRecord = {
  amount_minor: number | null
  attempt_count: number
  charge_id: string | null
  currency_code: "usd" | null
  event_created_at: Date
  event_type: StripeLifecycleEventType
  id: string
  last_error_code: string | null
  livemode: boolean
  metadata: UnknownRecord
  next_retry_at: Date | null
  object_id: string
  order_id: string | null
  payment_intent_id: string | null
  processed_at: Date | null
  processing_started_at: Date | null
  provider_event_id: string
  provider_object_status: string | null
  received_at: Date
  status: StripeLifecycleEventStatus
}

export const stripeLifecycleEventIdFrom = (value: unknown): string =>
  requiredIdentifier(value, lifecycleEventIdPattern)

export const stripeLifecycleErrorCodeFrom = (value: unknown): string =>
  requiredIdentifier(value, errorCodePattern)

export const stripeLifecycleMetadataFrom = (value: unknown): UnknownRecord => {
  const metadata = asUnknownRecord(value)
  if (!metadata) {
    throw lifecycleDataError()
  }
  const allowedKeys = new Set([
    "ignored_reason",
    "tax_association_status",
    "tax_evidence_found",
    "tax_evidence_status",
  ])
  if (Object.keys(metadata).some((key) => !allowedKeys.has(key))) {
    throw lifecycleDataError()
  }

  const normalized: UnknownRecord = {}
  if (Object.hasOwn(metadata, "ignored_reason")) {
    const ignoredReason = metadata.ignored_reason
    if (
      ignoredReason !== "payment_intent_missing" &&
      ignoredReason !== "tax_evidence_not_found"
    ) {
      throw lifecycleDataError()
    }
    normalized.ignored_reason = ignoredReason
  }
  if (Object.hasOwn(metadata, "tax_association_status")) {
    const associationStatus = metadata.tax_association_status
    if (
      typeof associationStatus !== "string" ||
      !associationStatusPattern.test(associationStatus)
    ) {
      throw lifecycleDataError()
    }
    normalized.tax_association_status = associationStatus
  }
  if (Object.hasOwn(metadata, "tax_evidence_found")) {
    if (typeof metadata.tax_evidence_found !== "boolean") {
      throw lifecycleDataError()
    }
    normalized.tax_evidence_found = metadata.tax_evidence_found
  }
  if (Object.hasOwn(metadata, "tax_evidence_status")) {
    const evidenceStatus = metadata.tax_evidence_status
    if (
      evidenceStatus !== null &&
      (typeof evidenceStatus !== "string" ||
        !taxQuoteEvidenceStatuses.includes(
          evidenceStatus as (typeof taxQuoteEvidenceStatuses)[number]
        ))
    ) {
      throw lifecycleDataError()
    }
    normalized.tax_evidence_status = evidenceStatus
  }
  return normalized
}

export const recordStripeLifecycleEventInputFrom = (
  value: unknown
): RecordStripeLifecycleEventInput => {
  const input = asUnknownRecord(value)
  if (!input || typeof input.livemode !== "boolean") {
    throw lifecycleDataError()
  }
  const eventType = eventTypeFrom(input.eventType)
  if (input.currencyCode !== "usd") {
    throw lifecycleDataError()
  }
  return {
    amountMinor: requiredAmountMinor(input.amountMinor),
    chargeId: nullableIdentifier(input.chargeId, chargeIdPattern),
    currencyCode: "usd",
    eventCreatedAt: requiredDate(input.eventCreatedAt),
    eventType,
    livemode: input.livemode,
    objectId: objectIdFrom(input.objectId, eventType),
    paymentIntentId: nullableIdentifier(
      input.paymentIntentId,
      paymentIntentIdPattern
    ),
    providerEventId: requiredIdentifier(input.providerEventId, eventIdPattern),
    providerObjectStatus: nullableProviderStatus(input.providerObjectStatus),
  }
}

export const completeStripeLifecycleEventInputFrom = (
  value: unknown
): CompleteStripeLifecycleEventInput => {
  const input = asUnknownRecord(value)
  if (!input || (input.status !== "ignored" && input.status !== "processed")) {
    throw lifecycleDataError()
  }
  const orderId = optionalIdentifier(input.orderId, orderIdPattern)
  return {
    id: stripeLifecycleEventIdFrom(input.id),
    metadata: stripeLifecycleMetadataFrom(input.metadata),
    ...(orderId ? { orderId } : {}),
    providerObjectStatus: nullableProviderStatus(input.providerObjectStatus),
    status: input.status,
  }
}

export const stripeLifecycleRecordFrom = (
  value: unknown
): StripeLifecycleRecord => {
  const record = asUnknownRecord(value)
  if (!record || typeof record.livemode !== "boolean") {
    throw lifecycleDataError()
  }
  const eventType = eventTypeFrom(record.event_type)
  const attemptCount = requiredAmountMinor(record.attempt_count)
  if (attemptCount > MAX_LIFECYCLE_ATTEMPTS) {
    throw lifecycleDataError()
  }
  const currencyCode = record.currency_code
  if (currencyCode !== null && currencyCode !== "usd") {
    throw lifecycleDataError()
  }
  const lastErrorCode =
    record.last_error_code === null
      ? null
      : stripeLifecycleErrorCodeFrom(record.last_error_code)
  return {
    amount_minor: nullableAmountMinor(record.amount_minor),
    attempt_count: attemptCount,
    charge_id: nullableIdentifier(record.charge_id, chargeIdPattern),
    currency_code: currencyCode,
    event_created_at: requiredDate(record.event_created_at),
    event_type: eventType,
    id: stripeLifecycleEventIdFrom(record.id),
    last_error_code: lastErrorCode,
    livemode: record.livemode,
    metadata: stripeLifecycleMetadataFrom(record.metadata),
    next_retry_at: nullableDate(record.next_retry_at),
    object_id: objectIdFrom(record.object_id, eventType),
    order_id: nullableIdentifier(record.order_id, orderIdPattern),
    payment_intent_id: nullableIdentifier(
      record.payment_intent_id,
      paymentIntentIdPattern
    ),
    processed_at: nullableDate(record.processed_at),
    processing_started_at: nullableDate(record.processing_started_at),
    provider_event_id: requiredIdentifier(
      record.provider_event_id,
      eventIdPattern
    ),
    provider_object_status: nullableProviderStatus(
      record.provider_object_status
    ),
    received_at: requiredDate(record.received_at),
    status: eventStatusFrom(record.status),
  }
}

export const stripeLifecycleReceiptMatches = (
  existing: StripeLifecycleRecord,
  input: RecordStripeLifecycleEventInput
): boolean =>
  existing.event_type === input.eventType &&
  existing.object_id === input.objectId &&
  existing.payment_intent_id === input.paymentIntentId &&
  existing.charge_id === input.chargeId &&
  existing.livemode === input.livemode &&
  existing.amount_minor === input.amountMinor &&
  existing.currency_code === input.currencyCode &&
  existing.event_created_at.getTime() === input.eventCreatedAt.getTime()

export const stripeLifecycleRetryDelayMs = (attemptCount: unknown): number => {
  if (
    typeof attemptCount !== "number" ||
    !Number.isSafeInteger(attemptCount) ||
    attemptCount < 1 ||
    attemptCount > MAX_LIFECYCLE_ATTEMPTS
  ) {
    throw lifecycleDataError()
  }
  return Math.min(60 * 60 * 1_000, 60 * 1_000 * 2 ** (attemptCount - 1))
}
