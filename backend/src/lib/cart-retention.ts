import type {
  FilterableCartProps,
  ICartModuleService,
  ILockingModule,
} from "@medusajs/framework/types"

import {
  readCheckoutAnonymousRetentionPage,
  readCheckoutAnonymousRetentionSelection,
  type CheckoutAnonymousRetentionCartRecord,
} from "./checkout/persistence-contracts"

const DAY_MS = 24 * 60 * 60 * 1_000
const MINIMUM_RETENTION_DAYS = 37
const DEFAULT_RETENTION_DAYS = MINIMUM_RETENTION_DAYS
const DEFAULT_MAX_DELETIONS_PER_RUN = 1_000
const MAX_DELETIONS_PER_RUN_LIMIT = 10_000
const PAGE_SIZE = 250
const DELETE_BATCH_SIZE = 100

export type CartRetentionConfig = {
  enabled: boolean
  retentionDays: number
  maxDeletionsPerRun: number
}

export type CartRetentionResult = {
  cutoff: string
  deleted: number
  protectedByEmail: number
  scanned: number
  capped: boolean
}

type CartRetentionServices = {
  cartService: Pick<ICartModuleService, "deleteCarts" | "listCarts">
  lockingService: Pick<ILockingModule, "execute">
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

export const resolveCartRetentionConfig = (
  environment: NodeJS.ProcessEnv = process.env
): CartRetentionConfig => ({
  enabled: parseBoolean(environment.ANONYMOUS_CART_RETENTION_ENABLED),
  retentionDays: parseBoundedInteger({
    name: "ANONYMOUS_CART_RETENTION_DAYS",
    value: environment.ANONYMOUS_CART_RETENTION_DAYS,
    defaultValue: DEFAULT_RETENTION_DAYS,
    minimum: MINIMUM_RETENTION_DAYS,
    maximum: 365,
  }),
  maxDeletionsPerRun: parseBoundedInteger({
    name: "ANONYMOUS_CART_RETENTION_MAX_DELETIONS",
    value: environment.ANONYMOUS_CART_RETENTION_MAX_DELETIONS,
    defaultValue: DEFAULT_MAX_DELETIONS_PER_RUN,
    minimum: 1,
    maximum: MAX_DELETIONS_PER_RUN_LIMIT,
  }),
})

const eligibleCart = (cart: CheckoutAnonymousRetentionCartRecord): boolean =>
  cart.customerId === null && cart.email === null && cart.completedAt === null

const buildFilters = (cutoff: string): FilterableCartProps => ({
  customer_id: { $eq: null },
  completed_at: { $eq: null },
  updated_at: { $lt: cutoff },
})

const chunksOf = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

const lockAndDeleteFreshCandidates = async ({
  candidateIds,
  cartService,
  cutoff,
  lockingService,
}: CartRetentionServices & {
  candidateIds: string[]
  cutoff: string
}): Promise<number> =>
  lockingService.execute(candidateIds, async () => {
    const freshCandidates = readCheckoutAnonymousRetentionSelection(
      await cartService.listCarts(
        {
          ...buildFilters(cutoff),
          id: candidateIds,
        },
        {
          select: ["id", "customer_id", "email", "completed_at", "updated_at"],
          take: candidateIds.length + 1,
        }
      ),
      candidateIds
    )
    const safeIds = freshCandidates.filter(eligibleCart).map(({ id }) => id)
    if (!safeIds.length) {
      return 0
    }

    await cartService.deleteCarts(safeIds)
    const retained = readCheckoutAnonymousRetentionSelection(
      await cartService.listCarts(
        { id: safeIds },
        {
          select: ["id", "customer_id", "email", "completed_at", "updated_at"],
          take: safeIds.length + 1,
        }
      ),
      safeIds
    )
    if (retained.length > 0) {
      throw new Error("The anonymous cart deletion was not persisted.")
    }
    return safeIds.length
  })

export const removeExpiredAnonymousCarts = async ({
  cartService,
  config,
  lockingService,
  now = new Date(),
}: CartRetentionServices & {
  config: CartRetentionConfig
  now?: Date
}): Promise<CartRetentionResult> => {
  const cutoff = new Date(
    now.getTime() - config.retentionDays * DAY_MS
  ).toISOString()
  const protectedIds = new Set<string>()
  let deleted = 0
  let scanned = 0
  let skip = 0

  while (deleted < config.maxDeletionsPerRun) {
    const carts = readCheckoutAnonymousRetentionPage(
      await cartService.listCarts(buildFilters(cutoff), {
        select: ["id", "customer_id", "email", "completed_at", "updated_at"],
        order: { updated_at: "ASC", id: "ASC" },
        skip,
        take: PAGE_SIZE,
      }),
      PAGE_SIZE
    )
    if (!carts.length) {
      break
    }

    scanned += carts.length
    const eligible = carts.filter((cart) => {
      if (cart.email !== null) {
        protectedIds.add(cart.id)
      }
      return eligibleCart(cart)
    })
    const remaining = config.maxDeletionsPerRun - deleted
    const candidates = eligible.slice(0, remaining)

    if (!candidates.length) {
      skip += carts.length
      if (carts.length < PAGE_SIZE) {
        break
      }
      continue
    }

    for (const batch of chunksOf(candidates, DELETE_BATCH_SIZE)) {
      deleted += await lockAndDeleteFreshCandidates({
        cartService,
        lockingService,
        cutoff,
        candidateIds: batch.map(({ id }) => id),
      })
    }

    if (candidates.length < eligible.length) {
      break
    }
  }

  return {
    cutoff,
    deleted,
    protectedByEmail: protectedIds.size,
    scanned,
    capped: deleted >= config.maxDeletionsPerRun,
  }
}

export const CART_RETENTION_JOB_LOCK = "jobs:anonymous-cart-retention"
