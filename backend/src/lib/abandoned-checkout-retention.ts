import type {
  ICartModuleService,
  ILockingModule,
} from "@medusajs/framework/types"

const DAY_MS = 24 * 60 * 60 * 1_000
const MINIMUM_RETENTION_DAYS = 37
const DEFAULT_RETENTION_DAYS = MINIMUM_RETENTION_DAYS
const DEFAULT_MAX_DELETIONS_PER_RUN = 250
const MAX_DELETIONS_PER_RUN_LIMIT = 2_500
const PAGE_SIZE = 100

const SAFE_PAYMENT_COLLECTION_STATUSES = new Set([
  "not_started",
  "awaiting",
  "canceled",
])
const SAFE_PAYMENT_SESSION_STATUSES = new Set(["pending", "canceled", "error"])

type UnknownRecord = Record<string, unknown>

export type AbandonedCheckoutRetentionConfig = {
  enabled: boolean
  retentionDays: number
  maxDeletionsPerRun: number
}

export type AbandonedCheckoutRetentionResult = {
  cutoff: string
  scanned: number
  deleted: number
  paymentCollectionsCanceled: number
  protectedByOrder: number
  protectedByPayment: number
  capped: boolean
}

export type AbandonedCheckoutQuery = {
  graph: (query: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
    pagination?: {
      take?: number
      skip?: number
      order?: Record<string, "ASC" | "DESC">
    }
  }) => Promise<{ data: UnknownRecord[] }>
}

type RetentionServices = {
  query: AbandonedCheckoutQuery
  cartService: Pick<ICartModuleService, "deleteCarts">
  lockingService: Pick<ILockingModule, "execute">
  cancelPaymentSessions: (paymentSessionIds: string[]) => Promise<void>
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

export const resolveAbandonedCheckoutRetentionConfig = (
  environment: NodeJS.ProcessEnv = process.env
): AbandonedCheckoutRetentionConfig => ({
  enabled: parseBoolean(environment.ABANDONED_CHECKOUT_RETENTION_ENABLED),
  retentionDays: parseBoundedInteger({
    name: "ABANDONED_CHECKOUT_RETENTION_DAYS",
    value: environment.ABANDONED_CHECKOUT_RETENTION_DAYS,
    defaultValue: DEFAULT_RETENTION_DAYS,
    minimum: MINIMUM_RETENTION_DAYS,
    maximum: 365,
  }),
  maxDeletionsPerRun: parseBoundedInteger({
    name: "ABANDONED_CHECKOUT_RETENTION_MAX_DELETIONS",
    value: environment.ABANDONED_CHECKOUT_RETENTION_MAX_DELETIONS,
    defaultValue: DEFAULT_MAX_DELETIONS_PER_RUN,
    minimum: 1,
    maximum: MAX_DELETIONS_PER_RUN_LIMIT,
  }),
})

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" ? (value as UnknownRecord) : null

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null

const paymentSafety = (
  cart: UnknownRecord
): {
  safe: boolean
  paymentSessionIds: string[]
  requiresCancellation: boolean
} => {
  const collection = asRecord(cart.payment_collection)
  if (!collection) {
    return {
      safe: true,
      paymentSessionIds: [],
      requiresCancellation: false,
    }
  }

  const paymentCollectionId = text(collection.id)
  const collectionStatus = text(collection.status)
  if (
    !paymentCollectionId ||
    !collectionStatus ||
    !SAFE_PAYMENT_COLLECTION_STATUSES.has(collectionStatus)
  ) {
    return {
      safe: false,
      paymentSessionIds: [],
      requiresCancellation: false,
    }
  }

  const sessions = Array.isArray(collection.payment_sessions)
    ? collection.payment_sessions
    : []
  const paymentSessionIds = sessions
    .map((value) => text(asRecord(value)?.id))
    .filter((id): id is string => id !== null)
  const sessionsAreSafe = sessions.every((value) => {
    const session = asRecord(value)
    const status = text(session?.status)
    return status !== null && SAFE_PAYMENT_SESSION_STATUSES.has(status)
  })

  return {
    safe: sessionsAreSafe,
    paymentSessionIds,
    requiresCancellation: sessionsAreSafe && paymentSessionIds.length > 0,
  }
}

const checkoutCandidate = (cart: UnknownRecord, cutoff: string): boolean => {
  const updatedAt = text(cart.updated_at)
  const updatedAtTime = updatedAt ? Date.parse(updatedAt) : Number.NaN
  const cutoffTime = Date.parse(cutoff)

  return (
    text(cart.id) !== null &&
    text(cart.email) !== null &&
    text(cart.customer_id) === null &&
    (cart.completed_at === null || cart.completed_at === undefined) &&
    Number.isFinite(updatedAtTime) &&
    Number.isFinite(cutoffTime) &&
    updatedAtTime < cutoffTime
  )
}

const cartFields = [
  "id",
  "email",
  "customer_id",
  "completed_at",
  "updated_at",
  "payment_collection.id",
  "payment_collection.status",
  "payment_collection.payment_sessions.id",
  "payment_collection.payment_sessions.status",
  "payment_collection.payment_sessions.provider_id",
]

const listCandidates = (
  query: AbandonedCheckoutQuery,
  cutoff: string,
  skip: number
): Promise<{ data: UnknownRecord[] }> =>
  query.graph({
    entity: "cart",
    fields: cartFields,
    filters: {
      customer_id: { $eq: null },
      completed_at: { $eq: null },
      updated_at: { $lt: cutoff },
    },
    pagination: {
      take: PAGE_SIZE,
      skip,
      order: { updated_at: "ASC" },
    },
  })

const retrieveCandidate = async (
  query: AbandonedCheckoutQuery,
  cartId: string
): Promise<UnknownRecord | null> => {
  const result = await query.graph({
    entity: "cart",
    fields: cartFields,
    filters: { id: cartId },
    pagination: { take: 1 },
  })
  return result.data[0] ?? null
}

const hasOrder = async (
  query: AbandonedCheckoutQuery,
  cartId: string
): Promise<boolean> => {
  const result = await query.graph({
    entity: "order_cart",
    fields: ["order_id"],
    filters: { cart_id: cartId },
    pagination: { take: 1 },
  })
  return text(result.data[0]?.order_id) !== null
}

type CandidateResult =
  | "deleted"
  | "deleted_after_cancel"
  | "protected_by_order"
  | "protected_by_payment"
  | "no_longer_eligible"

const processCandidate = async ({
  candidateId,
  cartService,
  cancelPaymentSessions,
  cutoff,
  lockingService,
  query,
}: RetentionServices & {
  candidateId: string
  cutoff: string
}): Promise<CandidateResult> =>
  lockingService.execute(candidateId, async () => {
    const fresh = await retrieveCandidate(query, candidateId)
    if (!fresh || !checkoutCandidate(fresh, cutoff)) {
      return "no_longer_eligible"
    }
    if (await hasOrder(query, candidateId)) {
      return "protected_by_order"
    }

    const payment = paymentSafety(fresh)
    if (!payment.safe) {
      return "protected_by_payment"
    }

    if (payment.requiresCancellation) {
      await cancelPaymentSessions(payment.paymentSessionIds)
      await cartService.deleteCarts([candidateId])
      return "deleted_after_cancel"
    }

    await cartService.deleteCarts([candidateId])
    return "deleted"
  })

export const removeAbandonedGuestCheckouts = async ({
  cartService,
  cancelPaymentSessions,
  config,
  lockingService,
  now = new Date(),
  query,
}: RetentionServices & {
  config: AbandonedCheckoutRetentionConfig
  now?: Date
}): Promise<AbandonedCheckoutRetentionResult> => {
  const cutoff = new Date(
    now.getTime() - config.retentionDays * DAY_MS
  ).toISOString()
  let scanned = 0
  let deleted = 0
  let paymentCollectionsCanceled = 0
  let protectedByOrder = 0
  let protectedByPayment = 0
  let skip = 0

  while (deleted < config.maxDeletionsPerRun) {
    const { data } = await listCandidates(query, cutoff, skip)
    if (!data.length) {
      break
    }
    scanned += data.length

    const candidates = data
      .filter((candidate) => checkoutCandidate(candidate, cutoff))
      .slice(0, config.maxDeletionsPerRun - deleted)
    if (!candidates.length) {
      skip += data.length
      if (data.length < PAGE_SIZE) {
        break
      }
      continue
    }

    let changedPage = false
    for (const candidate of candidates) {
      const candidateId = text(candidate.id)
      if (!candidateId) {
        continue
      }
      const result = await processCandidate({
        cartService,
        cancelPaymentSessions,
        cutoff,
        lockingService,
        query,
        candidateId,
      })
      switch (result) {
        case "deleted_after_cancel":
          paymentCollectionsCanceled += 1
          deleted += 1
          changedPage = true
          break
        case "deleted":
          deleted += 1
          changedPage = true
          break
        case "protected_by_order":
          protectedByOrder += 1
          break
        case "protected_by_payment":
          protectedByPayment += 1
          break
        case "no_longer_eligible":
          break
      }
    }

    if (!changedPage) {
      skip += data.length
    }
    if (data.length < PAGE_SIZE) {
      break
    }
  }

  return {
    cutoff,
    scanned,
    deleted,
    paymentCollectionsCanceled,
    protectedByOrder,
    protectedByPayment,
    capped: deleted >= config.maxDeletionsPerRun,
  }
}

export const ABANDONED_CHECKOUT_RETENTION_JOB_LOCK =
  "jobs:abandoned-checkout-retention"
