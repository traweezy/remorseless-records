import type { TaxProviderName } from "../../modules/tax-control/constants"
import { readNonNegativeSafeInteger } from "../provider-boundary/primitives"
import {
  asUnknownRecord as asRecord,
  readProviderDataRecords,
  readRecordArray,
  type UnknownRecord,
} from "../provider-boundary/records"

export type TaxControlImpactQuery = {
  graph: (input: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
    pagination?: {
      order?: Record<string, "ASC" | "DESC">
      skip?: number
      take?: number
    }
  }) => Promise<unknown>
}

export type TaxControlImpact = {
  activityWindowDays: number
  frozenByCollectionMode: Record<"collect" | "disabled", number>
  frozenByProvider: Record<TaxProviderName, number>
  paymentsFinalizing: number
  preparedCheckouts: number
}

const DAY_MS = 24 * 60 * 60 * 1_000
const ACTIVITY_WINDOW_DAYS = 30
const PAGE_SIZE = 250

const PROCESSABLE_PAYMENT_STATUSES = new Set([
  "authorized",
  "captured",
  "pending",
  "pending_authorization",
  "requires_more",
])

const FINALIZING_PAYMENT_STATUSES = new Set([
  "authorized",
  "captured",
  "pending_authorization",
])

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null

const impactPageFrom = (
  value: unknown,
  expectedSkip: number
): { records: UnknownRecord[]; total: number | null } => {
  const records = readProviderDataRecords(value, "Tax-control impact query")
  const envelope = asRecord(value)
  const metadataValue = envelope?.metadata
  if (metadataValue === null || metadataValue === undefined) {
    return { records, total: null }
  }
  const metadata = asRecord(metadataValue)
  const count = readNonNegativeSafeInteger(metadata?.count)
  const skip = readNonNegativeSafeInteger(metadata?.skip)
  const take = readNonNegativeSafeInteger(metadata?.take)
  const hasSkip = metadata ? Object.hasOwn(metadata, "skip") : false
  const hasTake = metadata ? Object.hasOwn(metadata, "take") : false
  if (
    !metadata ||
    count === null ||
    count < expectedSkip + records.length ||
    (hasSkip && skip !== expectedSkip) ||
    (hasTake && take !== PAGE_SIZE)
  ) {
    throw new Error("Tax-control impact pagination metadata is malformed.")
  }
  return { records, total: count }
}

export const summarizeTaxControlImpact = (
  carts: UnknownRecord[]
): TaxControlImpact => {
  let preparedCheckouts = 0
  let paymentsFinalizing = 0
  const frozenByProvider: Record<TaxProviderName, number> = {
    stripe_tax: 0,
    taxrate_io: 0,
  }
  const frozenByCollectionMode = { collect: 0, disabled: 0 }

  for (const cart of carts) {
    const collection = asRecord(cart.payment_collection)
    if (
      cart.payment_collection !== null &&
      cart.payment_collection !== undefined &&
      !collection
    ) {
      throw new Error("Tax-control impact payment collection is malformed.")
    }
    const sessions = readRecordArray(collection?.payment_sessions, {
      context: "Tax-control impact payment-session query",
      optional: true,
    })
    let prepared = false
    let finalizing = false
    let frozenProvider: TaxProviderName | null = null
    let frozenCollectionMode: "collect" | "disabled" | null = null

    for (const session of sessions) {
      if (text(session.provider_id) !== "pp_stripe_stripe") {
        continue
      }
      const status = text(session.status)
      if (!status) {
        throw new Error("Tax-control impact payment status is malformed.")
      }
      const isProcessable = PROCESSABLE_PAYMENT_STATUSES.has(status)
      if (isProcessable) {
        prepared = true
      }
      if (FINALIZING_PAYMENT_STATUSES.has(status)) {
        finalizing = true
      }
      if (!isProcessable) {
        continue
      }
      const sessionData = asRecord(session.data)
      const metadata = asRecord(sessionData?.metadata)
      if (
        (session.data !== null && session.data !== undefined && !sessionData) ||
        (sessionData?.metadata !== null &&
          sessionData?.metadata !== undefined &&
          !metadata)
      ) {
        throw new Error("Tax-control impact payment metadata is malformed.")
      }
      const provider = text(metadata?.rr_tax_provider)
      const collectionMode = text(metadata?.rr_tax_collection_mode)
      const resolvedMode =
        collectionMode === "disabled"
          ? "disabled"
          : collectionMode === "collect" ||
              provider === "stripe_tax" ||
              provider === "taxrate_io"
            ? "collect"
            : null
      const resolvedProvider =
        provider === "stripe_tax" || provider === "taxrate_io" ? provider : null
      if (
        isProcessable &&
        (!resolvedMode ||
          (resolvedMode === "collect" && !resolvedProvider) ||
          (resolvedMode === "disabled" && resolvedProvider))
      ) {
        throw new Error("Tax-control impact tax identity is malformed.")
      }
      if (
        resolvedMode &&
        frozenCollectionMode &&
        resolvedMode !== frozenCollectionMode
      ) {
        throw new Error("Tax-control impact tax identity is inconsistent.")
      }
      if (
        resolvedProvider &&
        frozenProvider &&
        resolvedProvider !== frozenProvider
      ) {
        throw new Error("Tax-control impact tax identity is inconsistent.")
      }
      frozenCollectionMode = resolvedMode ?? frozenCollectionMode
      frozenProvider = resolvedProvider ?? frozenProvider
    }

    if (prepared) {
      preparedCheckouts += 1
    }
    if (finalizing) {
      paymentsFinalizing += 1
    }
    if (prepared && frozenProvider) {
      frozenByProvider[frozenProvider] += 1
    }
    if (prepared && frozenCollectionMode) {
      frozenByCollectionMode[frozenCollectionMode] += 1
    }
  }

  return {
    activityWindowDays: ACTIVITY_WINDOW_DAYS,
    frozenByCollectionMode,
    frozenByProvider,
    paymentsFinalizing,
    preparedCheckouts,
  }
}

export const loadTaxControlImpact = async (
  query: TaxControlImpactQuery,
  now = new Date()
): Promise<TaxControlImpact> => {
  const activeSince = new Date(
    now.getTime() - ACTIVITY_WINDOW_DAYS * DAY_MS
  ).toISOString()
  const carts: UnknownRecord[] = []
  const cartIds = new Set<string>()
  let skip = 0

  while (true) {
    const result = await query.graph({
      entity: "cart",
      fields: [
        "id",
        "payment_collection.payment_sessions.data",
        "payment_collection.payment_sessions.provider_id",
        "payment_collection.payment_sessions.status",
      ],
      filters: {
        completed_at: null,
        updated_at: { $gte: activeSince },
      },
      pagination: {
        order: { updated_at: "DESC" },
        skip,
        take: PAGE_SIZE,
      },
    })
    const page = impactPageFrom(result, skip)
    for (const cart of page.records) {
      const id = text(cart.id)
      if (!id || cartIds.has(id)) {
        throw new Error("Tax-control impact cart identity is malformed.")
      }
      cartIds.add(id)
      carts.push(cart)
    }

    const total = page.total
    if (
      page.records.length === 0 ||
      page.records.length < PAGE_SIZE ||
      (total !== null && carts.length >= total)
    ) {
      if (total !== null && carts.length !== total) {
        throw new Error("Tax-control impact query returned a truncated page.")
      }
      break
    }
    skip += page.records.length
  }

  return summarizeTaxControlImpact(carts)
}
