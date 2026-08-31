import { randomUUID } from "node:crypto"
import { performance } from "node:perf_hooks"

import {
  asUnknownRecord,
  type UnknownRecord,
} from "../provider-boundary/records"
import {
  readCheckoutOrderLink,
  readCheckoutReconciliationCart,
  readCheckoutReconciliationPage,
  type CheckoutReconciliationCartRecord,
} from "./persistence-contracts"

const DEFAULT_MINIMUM_AGE_SECONDS = 120
const MINIMUM_AGE_SECONDS = 60
const MAXIMUM_AGE_SECONDS = 3_600
const DEFAULT_MAX_ATTEMPTS_PER_RUN = 50
const MAX_ATTEMPTS_PER_RUN_LIMIT = 250
const DEFAULT_MAX_SCAN_PER_RUN = 2_000
const MIN_SCAN_PER_RUN = 500
const MAX_SCAN_PER_RUN_LIMIT = 5_000
const DEFAULT_MAX_RUN_SECONDS = 90
const MIN_RUN_SECONDS = 30
const MAX_RUN_SECONDS = 240
const STRIPE_PROVIDER_ID = "pp_stripe_stripe"
const FINALIZED_PAYMENT_STATUSES = new Set(["authorized", "captured"])
const PROCESSABLE_PAYMENT_STATUSES = new Set([
  "pending",
  "requires_more",
  "authorized",
  "captured",
  "pending_authorization",
])

export type CheckoutReconciliationConfig = {
  enabled: boolean
  minimumAgeSeconds: number
  maxAttemptsPerRun: number
  maxRunSeconds: number
  maxScanPerRun: number
}

export type CheckoutReconciliationResult = {
  cutoff: string
  scanned: number
  scanWindowFull: boolean
  eligible: number
  attempted: number
  completed: number
  protectedByOrder: number
  failed: number
  heldForReview: number
  capped: boolean
  timeCapped: boolean
}

export type CheckoutReconciliationQuery = {
  graph: (query: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
    pagination?: {
      take?: number
      order?: Record<string, "ASC" | "DESC">
    }
  }) => Promise<unknown>
}

type ReconciliationServices = {
  query: CheckoutReconciliationQuery
  completeCart: (cartId: string) => Promise<void>
  updateCartMetadata: (
    cartId: string,
    metadata: Record<string, unknown>
  ) => Promise<void>
}

type CheckoutReconciliationAttemptState = "review_required" | "started"

type CheckoutReconciliationAttempt = {
  attempt_id: string
  started_at: string
  state: CheckoutReconciliationAttemptState
  updated_at: string
}

const parseBoolean = (value: string | undefined): boolean =>
  value?.trim().toLowerCase() === "true" || value?.trim() === "1"

const parseBoundedInteger = ({
  defaultValue,
  maximum,
  minimum,
  name,
  value,
}: {
  defaultValue: number
  maximum: number
  minimum: number
  name: string
  value: string | undefined
}): number => {
  if (!value?.trim()) {
    return defaultValue
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}`
    )
  }
  return parsed
}

export const resolveCheckoutReconciliationConfig = (
  environment: NodeJS.ProcessEnv = process.env
): CheckoutReconciliationConfig => ({
  enabled: parseBoolean(environment.CHECKOUT_RECONCILIATION_ENABLED),
  minimumAgeSeconds: parseBoundedInteger({
    name: "CHECKOUT_RECONCILIATION_MIN_AGE_SECONDS",
    value: environment.CHECKOUT_RECONCILIATION_MIN_AGE_SECONDS,
    defaultValue: DEFAULT_MINIMUM_AGE_SECONDS,
    minimum: MINIMUM_AGE_SECONDS,
    maximum: MAXIMUM_AGE_SECONDS,
  }),
  maxAttemptsPerRun: parseBoundedInteger({
    name: "CHECKOUT_RECONCILIATION_MAX_ATTEMPTS",
    value: environment.CHECKOUT_RECONCILIATION_MAX_ATTEMPTS,
    defaultValue: DEFAULT_MAX_ATTEMPTS_PER_RUN,
    minimum: 1,
    maximum: MAX_ATTEMPTS_PER_RUN_LIMIT,
  }),
  maxRunSeconds: parseBoundedInteger({
    name: "CHECKOUT_RECONCILIATION_MAX_RUN_SECONDS",
    value: environment.CHECKOUT_RECONCILIATION_MAX_RUN_SECONDS,
    defaultValue: DEFAULT_MAX_RUN_SECONDS,
    minimum: MIN_RUN_SECONDS,
    maximum: MAX_RUN_SECONDS,
  }),
  maxScanPerRun: parseBoundedInteger({
    name: "CHECKOUT_RECONCILIATION_MAX_SCAN",
    value: environment.CHECKOUT_RECONCILIATION_MAX_SCAN,
    defaultValue: DEFAULT_MAX_SCAN_PER_RUN,
    minimum: MIN_SCAN_PER_RUN,
    maximum: MAX_SCAN_PER_RUN_LIMIT,
  }),
})

const cartHasReconciliationAttempt = (
  cart: CheckoutReconciliationCartRecord
): boolean => Object.hasOwn(cart.metadata, CHECKOUT_RECONCILIATION_METADATA_KEY)

const cartHasExactReconciliationAttempt = (
  cart: CheckoutReconciliationCartRecord,
  expected: CheckoutReconciliationAttempt
): boolean => {
  const attempt = asUnknownRecord(
    cart.metadata[CHECKOUT_RECONCILIATION_METADATA_KEY]
  )
  return Boolean(
    attempt &&
      Object.keys(attempt).length === 4 &&
      attempt.attempt_id === expected.attempt_id &&
      attempt.started_at === expected.started_at &&
      attempt.state === expected.state &&
      attempt.updated_at === expected.updated_at
  )
}

const metadataWithAttempt = (
  cart: CheckoutReconciliationCartRecord,
  attempt: CheckoutReconciliationAttempt
): UnknownRecord => ({
  ...cart.metadata,
  [CHECKOUT_RECONCILIATION_METADATA_KEY]: attempt,
})

const checkoutNeedsReconciliation = (
  cart: CheckoutReconciliationCartRecord,
  cutoff: string
): boolean => {
  const updatedAtTime = Date.parse(cart.updatedAt)
  const cutoffTime = Date.parse(cutoff)
  if (
    cart.completedAt !== null ||
    !Number.isFinite(updatedAtTime) ||
    !Number.isFinite(cutoffTime) ||
    updatedAtTime >= cutoffTime
  ) {
    return false
  }

  const stripeProcessable = cart.paymentSessions.filter(
    ({ providerId, status }) =>
      providerId === STRIPE_PROVIDER_ID &&
      PROCESSABLE_PAYMENT_STATUSES.has(status)
  )

  return (
    stripeProcessable.length === 1 &&
    FINALIZED_PAYMENT_STATUSES.has(stripeProcessable[0]?.status ?? "")
  )
}

const cartFields = [
  "id",
  "completed_at",
  "metadata",
  "updated_at",
  "payment_collection.payment_sessions.id",
  "payment_collection.payment_sessions.status",
  "payment_collection.payment_sessions.provider_id",
]

const listCandidates = (
  query: CheckoutReconciliationQuery,
  cutoff: string,
  maxScanPerRun: number
): Promise<unknown> =>
  query.graph({
    entity: "cart",
    fields: cartFields,
    filters: {
      completed_at: { $eq: null },
      updated_at: { $lt: cutoff },
    },
    pagination: {
      take: maxScanPerRun,
      order: { updated_at: "DESC", id: "DESC" },
    },
  })

const retrieveCandidate = async (
  query: CheckoutReconciliationQuery,
  cartId: string
): Promise<CheckoutReconciliationCartRecord | null> => {
  const result = await query.graph({
    entity: "cart",
    fields: cartFields,
    filters: { id: cartId },
    pagination: { take: 2 },
  })
  return readCheckoutReconciliationCart(result, cartId)
}

const hasOrder = async (
  query: CheckoutReconciliationQuery,
  cartId: string
): Promise<boolean> => {
  return (
    readCheckoutOrderLink(
      await query.graph({
        entity: "order_cart",
        fields: ["order_id"],
        filters: { cart_id: cartId },
        pagination: { take: 2 },
      })
    ) !== null
  )
}

export const reconcileCheckoutPayments = async ({
  completeCart,
  config,
  createAttemptId = randomUUID,
  currentTime = () => new Date(),
  now = new Date(),
  monotonicNow = () => performance.now(),
  query,
  updateCartMetadata,
}: ReconciliationServices & {
  config: CheckoutReconciliationConfig
  createAttemptId?: () => string
  currentTime?: () => Date
  monotonicNow?: () => number
  now?: Date
}): Promise<CheckoutReconciliationResult> => {
  const startedAt = monotonicNow()
  const cutoff = new Date(
    now.getTime() - config.minimumAgeSeconds * 1_000
  ).toISOString()
  const data = readCheckoutReconciliationPage(
    await listCandidates(query, cutoff, config.maxScanPerRun),
    config.maxScanPerRun
  )
  const candidates = data.filter((cart) =>
    checkoutNeedsReconciliation(cart, cutoff)
  )
  let attempted = 0
  let completed = 0
  let protectedByOrder = 0
  let failed = 0
  let heldForReview = 0
  let inspectedEligible = 0
  let timeCapped = false

  for (const candidate of candidates) {
    if (attempted >= config.maxAttemptsPerRun) {
      break
    }
    if (monotonicNow() - startedAt >= config.maxRunSeconds * 1_000) {
      timeCapped = true
      break
    }
    inspectedEligible += 1
    const cartId = candidate.id
    const fresh = await retrieveCandidate(query, cartId)
    if (!fresh || !checkoutNeedsReconciliation(fresh, cutoff)) {
      continue
    }
    if (await hasOrder(query, cartId)) {
      protectedByOrder += 1
      continue
    }
    if (cartHasReconciliationAttempt(fresh)) {
      heldForReview += 1
      continue
    }

    const attemptId = createAttemptId()
    const attemptStartedAt = currentTime().toISOString()
    const startedAttempt: CheckoutReconciliationAttempt = {
      attempt_id: attemptId,
      started_at: attemptStartedAt,
      state: "started",
      updated_at: attemptStartedAt,
    }
    try {
      await updateCartMetadata(
        cartId,
        metadataWithAttempt(fresh, startedAttempt)
      )
    } catch {
      failed += 1
      continue
    }

    const marked = await retrieveCandidate(query, cartId)
    if (
      !marked ||
      !checkoutNeedsReconciliation(marked, cutoff) ||
      !cartHasExactReconciliationAttempt(marked, startedAttempt)
    ) {
      failed += 1
      continue
    }
    if (await hasOrder(query, cartId)) {
      protectedByOrder += 1
      continue
    }

    attempted += 1
    try {
      await completeCart(cartId)
      completed += 1
    } catch {
      failed += 1
      const reviewRequiredAt = currentTime().toISOString()
      await updateCartMetadata(
        cartId,
        metadataWithAttempt(marked, {
          ...startedAttempt,
          state: "review_required",
          updated_at: reviewRequiredAt,
        })
      ).catch(() => undefined)
    }
  }

  return {
    cutoff,
    scanned: data.length,
    scanWindowFull: data.length >= config.maxScanPerRun,
    eligible: candidates.length,
    attempted,
    completed,
    protectedByOrder,
    failed,
    heldForReview,
    capped: candidates.length > inspectedEligible,
    timeCapped,
  }
}

export const CHECKOUT_RECONCILIATION_JOB_LOCK = "jobs:checkout-reconciliation"
export const CHECKOUT_RECONCILIATION_METADATA_KEY = "rr_checkout_reconciliation"
