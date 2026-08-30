export const PAYMENT_LIFECYCLE_MODULE = "payment_lifecycle"

export const STRIPE_LIFECYCLE_RECEIVED_EVENT =
  "payment-lifecycle.stripe-event-received"

export const stripeLifecycleEventStatuses = [
  "received",
  "processing",
  "processed",
  "ignored",
  "failed",
] as const

export type StripeLifecycleEventStatus =
  (typeof stripeLifecycleEventStatuses)[number]

export const stripeLifecycleEventTypes = [
  "refund.created",
  "refund.updated",
  "refund.failed",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
] as const

export type StripeLifecycleEventType =
  (typeof stripeLifecycleEventTypes)[number]

export const stripeLifecycleLockKey = (eventId: string): string =>
  `payment-lifecycle:${eventId}`
