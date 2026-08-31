import { MedusaError } from "@medusajs/framework/utils"

import { readIsoTimestamp } from "../provider-boundary/primitives"
import {
  asUnknownRecord,
  readRecordArray,
  type UnknownRecord,
} from "../provider-boundary/records"

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,254}$/u
const PAYMENT_SESSION_STATUSES = new Set([
  "authorized",
  "canceled",
  "captured",
  "error",
  "pending",
  "pending_authorization",
  "requires_more",
])
const STATUS_TOKEN = /^[a-z][a-z0-9_]{0,63}$/u
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u
const RESERVED_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"])

const invalidCheckoutPersistence = (): never => {
  throw new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    "The checkout persistence boundary returned invalid structured data."
  )
}

const record = (value: unknown): UnknownRecord =>
  asUnknownRecord(value) ?? invalidCheckoutPersistence()

const singletonRelation = (value: unknown): UnknownRecord | null => {
  if (value === null || value === undefined) {
    return null
  }
  if (!Array.isArray(value)) {
    return record(value)
  }
  if (value.length === 0) {
    return null
  }
  return value.length === 1 ? record(value[0]) : invalidCheckoutPersistence()
}

const recordArray = (value: unknown, maximumRows: number): UnknownRecord[] => {
  let parsed: UnknownRecord[]
  try {
    parsed = readRecordArray(value, {
      context: "Checkout persistence",
    })
  } catch {
    return invalidCheckoutPersistence()
  }
  return parsed.length <= maximumRows ? parsed : invalidCheckoutPersistence()
}

const records = (value: unknown, maximumRows: number): UnknownRecord[] => {
  const envelope = record(value)
  return recordArray(envelope.data, maximumRows)
}

const identifier = (value: unknown, prefix: string): string =>
  typeof value === "string" &&
  value.startsWith(prefix) &&
  value === value.trim() &&
  IDENTIFIER.test(value)
    ? value
    : invalidCheckoutPersistence()

const optionalIdentifier = (value: unknown, prefix: string): string | null =>
  value === null ? null : identifier(value, prefix)

const identifierWithPrefixes = (
  value: unknown,
  prefixes: readonly string[]
): string => {
  const parsed = text(value, 255)
  return prefixes.some((prefix) => parsed.startsWith(prefix)) &&
    IDENTIFIER.test(parsed)
    ? parsed
    : invalidCheckoutPersistence()
}

const text = (value: unknown, maximumLength: number): string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= maximumLength &&
  value === value.trim() &&
  !CONTROL_CHARACTER.test(value)
    ? value
    : invalidCheckoutPersistence()

const statusToken = (value: unknown): string => {
  const parsed = text(value, 64)
  return STATUS_TOKEN.test(parsed) ? parsed : invalidCheckoutPersistence()
}

const nullableTimestamp = (value: unknown): string | null =>
  value === null
    ? null
    : (readIsoTimestamp(value) ?? invalidCheckoutPersistence())

const jsonValue = (value: unknown, depth = 0): unknown => {
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value
  }
  if (typeof value === "string") {
    return value.length <= 4_000 && !value.includes("\u0000")
      ? value
      : invalidCheckoutPersistence()
  }
  if (depth >= 5) {
    return invalidCheckoutPersistence()
  }
  if (Array.isArray(value)) {
    return value.length <= 100
      ? value.map((entry) => jsonValue(entry, depth + 1))
      : invalidCheckoutPersistence()
  }
  const source = asUnknownRecord(value)
  const prototype = source ? Object.getPrototypeOf(source) : undefined
  if (
    !source ||
    (prototype !== Object.prototype && prototype !== null) ||
    Object.keys(source).length > 100
  ) {
    return invalidCheckoutPersistence()
  }
  return Object.fromEntries(
    Object.entries(source).map(([key, entry]) => {
      const parsedKey = text(key, 200)
      if (RESERVED_OBJECT_KEYS.has(parsedKey)) {
        return invalidCheckoutPersistence()
      }
      return [parsedKey, jsonValue(entry, depth + 1)]
    })
  )
}

const metadataRecord = (value: unknown): UnknownRecord => {
  if (value === null) {
    return {}
  }
  const parsed = jsonValue(value)
  return asUnknownRecord(parsed) ?? invalidCheckoutPersistence()
}

export type CheckoutPaymentSessionRecord = {
  id: string
  providerId: string
  status: string
}

const paymentSessions = (
  value: unknown,
  options: { requireKnownStatus: boolean }
): CheckoutPaymentSessionRecord[] => {
  if (!Array.isArray(value) || value.length > 25) {
    return invalidCheckoutPersistence()
  }
  const ids = new Set<string>()
  return value.map((candidate) => {
    const source = record(candidate)
    const id = identifier(source.id, "payses_")
    const providerId = identifier(source.provider_id, "pp_")
    const status = statusToken(source.status)
    if (
      ids.has(id) ||
      (options.requireKnownStatus && !PAYMENT_SESSION_STATUSES.has(status))
    ) {
      return invalidCheckoutPersistence()
    }
    ids.add(id)
    return { id, providerId, status }
  })
}

const paymentCollectionSessions = (
  value: unknown,
  options: { requireKnownStatus: boolean }
): CheckoutPaymentSessionRecord[] => {
  const collection = singletonRelation(value)
  if (!collection) {
    return []
  }
  return paymentSessions(collection.payment_sessions, options)
}

export type CheckoutReconciliationCartRecord = {
  completedAt: string | null
  id: string
  metadata: UnknownRecord
  paymentSessions: CheckoutPaymentSessionRecord[]
  updatedAt: string
}

const reconciliationCart = (
  value: unknown,
  expectedId?: string
): CheckoutReconciliationCartRecord => {
  const source = record(value)
  const id = identifier(source.id, "cart_")
  if (expectedId !== undefined && id !== expectedId) {
    return invalidCheckoutPersistence()
  }
  return {
    completedAt: nullableTimestamp(source.completed_at),
    id,
    metadata: metadataRecord(source.metadata),
    paymentSessions: paymentCollectionSessions(source.payment_collection, {
      requireKnownStatus: true,
    }),
    updatedAt:
      nullableTimestamp(source.updated_at) ?? invalidCheckoutPersistence(),
  }
}

const orderedUniqueCarts = <T extends { id: string; updatedAt: string }>(
  carts: T[],
  direction: "ASC" | "DESC"
): T[] => {
  const ids = new Set<string>()
  let previous: { id: string; updatedAt: string } | null = null
  for (const cart of carts) {
    if (ids.has(cart.id)) {
      invalidCheckoutPersistence()
    }
    if (
      previous !== null &&
      ((direction === "ASC" &&
        (cart.updatedAt < previous.updatedAt ||
          (cart.updatedAt === previous.updatedAt && cart.id < previous.id))) ||
        (direction === "DESC" &&
          (cart.updatedAt > previous.updatedAt ||
            (cart.updatedAt === previous.updatedAt && cart.id > previous.id))))
    ) {
      invalidCheckoutPersistence()
    }
    ids.add(cart.id)
    previous = cart
  }
  return carts
}

export const readCheckoutReconciliationPage = (
  value: unknown,
  maximumRows: number
): CheckoutReconciliationCartRecord[] =>
  orderedUniqueCarts(
    records(value, maximumRows).map((entry) => reconciliationCart(entry)),
    "DESC"
  )

export const readCheckoutReconciliationCart = (
  value: unknown,
  expectedId: string
): CheckoutReconciliationCartRecord | null => {
  const found = records(value, 2)
  if (found.length > 1) {
    return invalidCheckoutPersistence()
  }
  return found[0] ? reconciliationCart(found[0], expectedId) : null
}

export type CheckoutRetentionCartRecord = {
  completedAt: string | null
  customerId: string | null
  email: string | null
  id: string
  paymentCollection: {
    id: string
    sessions: CheckoutPaymentSessionRecord[]
    status: string
  } | null
  updatedAt: string
}

const retentionCart = (
  value: unknown,
  expectedId?: string
): CheckoutRetentionCartRecord => {
  const source = record(value)
  const id = identifier(source.id, "cart_")
  if (expectedId !== undefined && id !== expectedId) {
    return invalidCheckoutPersistence()
  }
  const collection = singletonRelation(source.payment_collection)
  const paymentCollection = collection
    ? {
        id: identifierWithPrefixes(collection.id, ["paycol_", "pay_col_"]),
        sessions: paymentSessions(collection.payment_sessions, {
          requireKnownStatus: false,
        }),
        status: statusToken(collection.status),
      }
    : null
  return {
    completedAt: nullableTimestamp(source.completed_at),
    customerId: optionalIdentifier(source.customer_id, "cus_"),
    email: source.email === null ? null : text(source.email, 320),
    id,
    paymentCollection,
    updatedAt:
      nullableTimestamp(source.updated_at) ?? invalidCheckoutPersistence(),
  }
}

export const readCheckoutRetentionPage = (
  value: unknown,
  maximumRows: number
): CheckoutRetentionCartRecord[] =>
  orderedUniqueCarts(
    records(value, maximumRows).map((entry) => retentionCart(entry)),
    "ASC"
  )

export const readCheckoutRetentionCart = (
  value: unknown,
  expectedId: string
): CheckoutRetentionCartRecord | null => {
  const found = records(value, 2)
  if (found.length > 1) {
    return invalidCheckoutPersistence()
  }
  return found[0] ? retentionCart(found[0], expectedId) : null
}

export type CheckoutAnonymousRetentionCartRecord = {
  completedAt: string | null
  customerId: string | null
  email: string | null
  id: string
  updatedAt: string
}

const anonymousRetentionCart = (
  value: unknown
): CheckoutAnonymousRetentionCartRecord => {
  const source = record(value)
  return {
    completedAt: nullableTimestamp(source.completed_at),
    customerId: optionalIdentifier(source.customer_id, "cus_"),
    email: source.email === null ? null : text(source.email, 320),
    id: identifier(source.id, "cart_"),
    updatedAt:
      nullableTimestamp(source.updated_at) ?? invalidCheckoutPersistence(),
  }
}

export const readCheckoutAnonymousRetentionPage = (
  value: unknown,
  maximumRows: number
): CheckoutAnonymousRetentionCartRecord[] =>
  orderedUniqueCarts(
    recordArray(value, maximumRows).map(anonymousRetentionCart),
    "ASC"
  )

export const readCheckoutAnonymousRetentionSelection = (
  value: unknown,
  expectedIds: readonly string[]
): CheckoutAnonymousRetentionCartRecord[] => {
  const expected = new Set(expectedIds)
  if (expected.size !== expectedIds.length) {
    return invalidCheckoutPersistence()
  }
  const found = recordArray(value, expectedIds.length).map(
    anonymousRetentionCart
  )
  const foundIds = new Set<string>()
  for (const cart of found) {
    if (!expected.has(cart.id) || foundIds.has(cart.id)) {
      return invalidCheckoutPersistence()
    }
    foundIds.add(cart.id)
  }
  return found
}

export type CheckoutStatusCartRecord = {
  completedAt: string | null
  id: string
  paymentSessions: CheckoutPaymentSessionRecord[]
}

export const readCheckoutStatusCart = (
  value: unknown,
  expectedId: string
): CheckoutStatusCartRecord | null => {
  const found = records(value, 2)
  if (found.length > 1) {
    return invalidCheckoutPersistence()
  }
  if (!found[0]) {
    return null
  }
  const source = found[0]
  const id = identifier(source.id, "cart_")
  if (id !== expectedId) {
    return invalidCheckoutPersistence()
  }
  return {
    completedAt: nullableTimestamp(source.completed_at),
    id,
    paymentSessions: paymentCollectionSessions(source.payment_collection, {
      requireKnownStatus: true,
    }),
  }
}

export const readCheckoutOrderLink = (value: unknown): string | null => {
  const found = records(value, 2)
  if (found.length > 1) {
    return invalidCheckoutPersistence()
  }
  return found[0] ? identifier(found[0].order_id, "order_") : null
}
