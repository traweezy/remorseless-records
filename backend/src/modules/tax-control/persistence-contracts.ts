import { MedusaError } from "@medusajs/framework/utils"

import {
  asUnknownRecord,
  type UnknownRecord,
} from "../../lib/provider-boundary/records"
import { readIsoTimestamp } from "../../lib/provider-boundary/primitives"
import {
  taxCollectionModes,
  taxProviderNames,
  taxQuoteEvidenceStatuses,
  type TaxCollectionMode,
  type TaxProviderName,
  type TaxQuoteEvidenceStatus,
} from "./constants"

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,254}$/u
const FINGERPRINT = /^[A-Za-z0-9_-]{32,128}$/u
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const ASSOCIATION_STATUS = /^[a-z0-9_:,.-]{2,512}$/u
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u
const FORBIDDEN_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"])
const MAX_AMOUNT_MINOR = 99_999_999
const MAX_GENERATION = 1_000_000

export type TaxProviderControlRecord = {
  active_provider: TaxProviderName
  collection_mode: TaxCollectionMode
  generation: number
  id: string
  last_switch_reason: string | null
  last_switched_by: string | null
  metadata: UnknownRecord
  updated_at: Date
}

export type TaxProviderAuditRecord = {
  acknowledgement_version: string
  actor_id: string
  created_at: Date
  from_collection_mode: TaxCollectionMode
  from_generation: number
  from_provider: TaxProviderName
  id: string
  idempotency_key: string
  metadata: UnknownRecord
  reason: string
  to_collection_mode: TaxCollectionMode
  to_generation: number
  to_provider: TaxProviderName
}

export type TaxProviderQuotaRecord = {
  id: string
  metadata: UnknownRecord
  observed_at: Date
  provider: "taxrate_io"
  quota: number
  remaining: number
  source: "checkout_lookup" | "manual_refresh"
  usage: number
  usage_percent: number
}

export type TaxQuoteEvidenceRecord = {
  amount_minor: number
  association_status: string | null
  calculation_id: string | null
  cart_id: string
  collection_mode: TaxCollectionMode
  currency_code: "usd"
  fingerprint: string
  generation: number
  id: string
  last_verified_at: Date
  linked_at: Date
  metadata: UnknownRecord
  order_id: string | null
  payment_intent_id: string
  provider: TaxProviderName | null
  status: TaxQuoteEvidenceStatus
  tax_transaction_id: string | null
}

const invalidPersistence = (message: string): never => {
  throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, message)
}

const record = (value: unknown, message: string): UnknownRecord =>
  asUnknownRecord(value) ?? invalidPersistence(message)

const rows = (
  value: unknown,
  maximumRows: number,
  message: string
): UnknownRecord[] => {
  if (!Array.isArray(value) || value.length > maximumRows) {
    return invalidPersistence(message)
  }
  return value.map((entry) => record(entry, message))
}

const identifier = (value: unknown, prefix: string, message: string): string =>
  typeof value === "string" &&
  value.startsWith(prefix) &&
  IDENTIFIER.test(value)
    ? value
    : invalidPersistence(message)

const nullableIdentifier = (
  value: unknown,
  prefix: string,
  message: string
): string | null => (value === null ? null : identifier(value, prefix, message))

const boundedText = (
  value: unknown,
  minimum: number,
  maximum: number,
  message: string
): string =>
  typeof value === "string" &&
  value.length >= minimum &&
  value.length <= maximum &&
  value === value.trim() &&
  !CONTROL_CHARACTERS.test(value)
    ? value
    : invalidPersistence(message)

const nullableText = (
  value: unknown,
  maximum: number,
  message: string
): string | null =>
  value === null ? null : boundedText(value, 1, maximum, message)

const safeInteger = (
  value: unknown,
  minimum: number,
  maximum: number,
  message: string
): number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= minimum &&
  value <= maximum
    ? value
    : invalidPersistence(message)

const enumValue = <T extends string>(
  value: unknown,
  values: readonly T[],
  message: string
): T =>
  typeof value === "string" && values.includes(value as T)
    ? (value as T)
    : invalidPersistence(message)

const requiredDate = (value: unknown, message: string): Date => {
  const normalized = readIsoTimestamp(value)
  return normalized ? new Date(normalized) : invalidPersistence(message)
}

const parseJson = (value: unknown, depth: number, message: string): unknown => {
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value
  }
  if (typeof value === "string") {
    return value.length <= 10_000 && !value.includes("\u0000")
      ? value
      : invalidPersistence(message)
  }
  if (depth >= 8) {
    return invalidPersistence(message)
  }
  if (Array.isArray(value)) {
    return value.length <= 500
      ? value.map((entry) => parseJson(entry, depth + 1, message))
      : invalidPersistence(message)
  }
  const source = asUnknownRecord(value)
  if (!source || Object.keys(source).length > 200) {
    return invalidPersistence(message)
  }
  return Object.fromEntries(
    Object.entries(source).map(([key, entry]) => {
      if (
        !key ||
        key.length > 255 ||
        key.includes("\u0000") ||
        FORBIDDEN_JSON_KEYS.has(key)
      ) {
        invalidPersistence(message)
      }
      return [key, parseJson(entry, depth + 1, message)]
    })
  )
}

export const taxControlMetadataFrom = (
  value: unknown,
  message = "Tax control metadata is invalid."
): UnknownRecord => {
  const parsed = asUnknownRecord(parseJson(value, 0, message))
  if (!parsed || JSON.stringify(parsed).length > 100_000) {
    return invalidPersistence(message)
  }
  return parsed
}

const provider = (value: unknown, message: string): TaxProviderName =>
  enumValue(value, taxProviderNames, message)

const collectionMode = (value: unknown, message: string): TaxCollectionMode =>
  enumValue(value, taxCollectionModes, message)

const status = (value: unknown, message: string): TaxQuoteEvidenceStatus =>
  enumValue(value, taxQuoteEvidenceStatuses, message)

export const taxProviderControlFrom = (
  value: unknown,
  message = "The stored tax provider control is invalid."
): TaxProviderControlRecord => {
  const source = record(value, message)
  return {
    active_provider: provider(source.active_provider, message),
    collection_mode: collectionMode(source.collection_mode, message),
    generation: safeInteger(source.generation, 1, MAX_GENERATION, message),
    id: identifier(source.id, "taxctrl_", message),
    last_switch_reason: nullableText(source.last_switch_reason, 500, message),
    last_switched_by: nullableText(source.last_switched_by, 255, message),
    metadata: taxControlMetadataFrom(source.metadata, message),
    updated_at: requiredDate(source.updated_at, message),
  }
}

export const taxProviderControlMutationFrom = (
  value: unknown,
  message = "The tax provider control was not persisted exactly once."
): TaxProviderControlRecord => {
  const parsed = rows(value, 1, message)
  return parsed.length === 1
    ? taxProviderControlFrom(parsed[0], message)
    : invalidPersistence(message)
}

export const taxProviderAuditFrom = (
  value: unknown,
  message = "The stored tax provider audit is invalid."
): TaxProviderAuditRecord => {
  const source = record(value, message)
  const fromGeneration = safeInteger(
    source.from_generation,
    1,
    MAX_GENERATION,
    message
  )
  const toGeneration = safeInteger(
    source.to_generation,
    2,
    MAX_GENERATION,
    message
  )
  if (toGeneration !== fromGeneration + 1) {
    return invalidPersistence(message)
  }
  return {
    acknowledgement_version: boundedText(
      source.acknowledgement_version,
      1,
      255,
      message
    ),
    actor_id: boundedText(source.actor_id, 1, 255, message),
    created_at: requiredDate(source.created_at, message),
    from_collection_mode: collectionMode(source.from_collection_mode, message),
    from_generation: fromGeneration,
    from_provider: provider(source.from_provider, message),
    id: identifier(source.id, "taxaudit_", message),
    idempotency_key:
      typeof source.idempotency_key === "string" &&
      UUID.test(source.idempotency_key)
        ? source.idempotency_key
        : invalidPersistence(message),
    metadata: taxControlMetadataFrom(source.metadata, message),
    reason: boundedText(source.reason, 10, 500, message),
    to_collection_mode: collectionMode(source.to_collection_mode, message),
    to_generation: toGeneration,
    to_provider: provider(source.to_provider, message),
  }
}

export const taxProviderAuditListFrom = (
  value: unknown,
  maximumRows = 1,
  message = "The stored tax provider audit query is invalid."
): TaxProviderAuditRecord[] => {
  const parsed = rows(value, maximumRows, message).map((entry) =>
    taxProviderAuditFrom(entry, message)
  )
  if (
    new Set(parsed.map((entry) => entry.id)).size !== parsed.length ||
    new Set(parsed.map((entry) => entry.idempotency_key)).size !== parsed.length
  ) {
    return invalidPersistence(message)
  }
  return parsed
}

export const taxProviderAuditMutationFrom = (
  value: unknown,
  message = "The tax provider audit was not persisted exactly once."
): TaxProviderAuditRecord => {
  const parsed = taxProviderAuditListFrom(value, 1, message)
  return parsed.length === 1 ? parsed[0]! : invalidPersistence(message)
}

export const taxProviderQuotaFrom = (
  value: unknown,
  message = "The stored TaxRate.io quota snapshot is invalid."
): TaxProviderQuotaRecord => {
  const source = record(value, message)
  const quota = safeInteger(source.quota, 1, 1_000_000_000, message)
  const remaining = safeInteger(source.remaining, 0, 1_000_000_000, message)
  const usage = safeInteger(source.usage, 0, 1_000_000_000, message)
  const usagePercent =
    typeof source.usage_percent === "number" &&
    Number.isFinite(source.usage_percent) &&
    source.usage_percent >= 0 &&
    source.usage_percent <= 100
      ? source.usage_percent
      : invalidPersistence(message)
  if (source.provider !== "taxrate_io" || remaining !== quota - usage) {
    return invalidPersistence(message)
  }
  return {
    id: identifier(source.id, "taxquota_", message),
    metadata: taxControlMetadataFrom(source.metadata, message),
    observed_at: requiredDate(source.observed_at, message),
    provider: "taxrate_io",
    quota,
    remaining,
    source:
      source.source === "checkout_lookup" || source.source === "manual_refresh"
        ? source.source
        : invalidPersistence(message),
    usage,
    usage_percent: usagePercent,
  }
}

export const taxProviderQuotaListFrom = (
  value: unknown,
  maximumRows = 1,
  message = "The persisted TaxRate.io quota snapshot is invalid."
): TaxProviderQuotaRecord[] => {
  const parsed = rows(value, maximumRows, message).map((entry) =>
    taxProviderQuotaFrom(entry, message)
  )
  if (
    new Set(parsed.map((entry) => entry.id)).size !== parsed.length ||
    new Set(parsed.map((entry) => entry.provider)).size !== parsed.length
  ) {
    return invalidPersistence(message)
  }
  return parsed
}

export const taxProviderQuotaMutationFrom = (
  value: unknown,
  message = "The TaxRate.io quota snapshot was not persisted exactly once."
): TaxProviderQuotaRecord => {
  const parsed = taxProviderQuotaListFrom(value, 1, message)
  return parsed.length === 1 ? parsed[0]! : invalidPersistence(message)
}

export const taxQuoteEvidenceFrom = (
  value: unknown,
  message = "The stored tax quote evidence is invalid."
): TaxQuoteEvidenceRecord => {
  const source = record(value, message)
  const mode = collectionMode(source.collection_mode, message)
  const evidenceProvider =
    source.provider === null ? null : provider(source.provider, message)
  if (
    (mode === "collect" && evidenceProvider === null) ||
    (mode === "disabled" && evidenceProvider !== null) ||
    (evidenceProvider === "stripe_tax" && source.calculation_id === null) ||
    (evidenceProvider !== "stripe_tax" && source.calculation_id !== null)
  ) {
    return invalidPersistence(message)
  }
  return {
    amount_minor: safeInteger(
      source.amount_minor,
      0,
      MAX_AMOUNT_MINOR,
      message
    ),
    association_status:
      source.association_status === null
        ? null
        : typeof source.association_status === "string" &&
            ASSOCIATION_STATUS.test(source.association_status)
          ? source.association_status
          : invalidPersistence(message),
    calculation_id: nullableIdentifier(
      source.calculation_id,
      "taxcalc_",
      message
    ),
    cart_id: identifier(source.cart_id, "cart_", message),
    collection_mode: mode,
    currency_code:
      source.currency_code === "usd"
        ? source.currency_code
        : invalidPersistence(message),
    fingerprint:
      typeof source.fingerprint === "string" &&
      FINGERPRINT.test(source.fingerprint)
        ? source.fingerprint
        : invalidPersistence(message),
    generation: safeInteger(source.generation, 1, MAX_GENERATION, message),
    id: identifier(source.id, "taxevidence_", message),
    last_verified_at: requiredDate(source.last_verified_at, message),
    linked_at: requiredDate(source.linked_at, message),
    metadata: taxControlMetadataFrom(source.metadata, message),
    order_id: nullableIdentifier(source.order_id, "order_", message),
    payment_intent_id: identifier(source.payment_intent_id, "pi_", message),
    provider: evidenceProvider,
    status: status(source.status, message),
    tax_transaction_id: nullableIdentifier(
      source.tax_transaction_id,
      "tax_",
      message
    ),
  }
}

export const taxQuoteEvidenceListFrom = (
  value: unknown,
  maximumRows = 1,
  message = "The stored tax quote evidence query is invalid."
): TaxQuoteEvidenceRecord[] => {
  const parsed = rows(value, maximumRows, message).map((entry) =>
    taxQuoteEvidenceFrom(entry, message)
  )
  const calculationIds = parsed
    .map((entry) => entry.calculation_id)
    .filter((id): id is string => id !== null)
  if (
    new Set(parsed.map((entry) => entry.id)).size !== parsed.length ||
    new Set(parsed.map((entry) => entry.payment_intent_id)).size !==
      parsed.length ||
    new Set(calculationIds).size !== calculationIds.length
  ) {
    return invalidPersistence(message)
  }
  return parsed
}

export const taxQuoteEvidenceMutationFrom = (
  value: unknown,
  message = "Tax quote evidence was not persisted exactly once."
): TaxQuoteEvidenceRecord => {
  const parsed = taxQuoteEvidenceListFrom(value, 1, message)
  return parsed.length === 1 ? parsed[0]! : invalidPersistence(message)
}

export const taxQuoteEvidenceCountFrom = (
  value: unknown,
  maximumRows = 1,
  message = "The stored tax quote evidence count is invalid."
): [TaxQuoteEvidenceRecord[], number] => {
  if (!Array.isArray(value) || value.length !== 2) {
    return invalidPersistence(message)
  }
  const parsedRows = taxQuoteEvidenceListFrom(value[0], maximumRows, message)
  const count = safeInteger(value[1], 0, 10_000_000, message)
  if (count < parsedRows.length) {
    return invalidPersistence(message)
  }
  return [parsedRows, count]
}

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`
  }
  const source = asUnknownRecord(value)
  if (source) {
    return `{${Object.keys(source)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${stableJson(source[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "undefined"
}

const sameDate = (left: Date, right: Date): boolean =>
  left.getTime() === right.getTime()

export const taxProviderControlMatches = (
  actual: TaxProviderControlRecord,
  expected: TaxProviderControlRecord
): boolean =>
  actual.active_provider === expected.active_provider &&
  actual.collection_mode === expected.collection_mode &&
  actual.generation === expected.generation &&
  actual.id === expected.id &&
  actual.last_switch_reason === expected.last_switch_reason &&
  actual.last_switched_by === expected.last_switched_by &&
  stableJson(actual.metadata) === stableJson(expected.metadata)

export const taxProviderAuditMatches = (
  actual: TaxProviderAuditRecord,
  expected: TaxProviderAuditRecord
): boolean =>
  actual.acknowledgement_version === expected.acknowledgement_version &&
  actual.actor_id === expected.actor_id &&
  sameDate(actual.created_at, expected.created_at) &&
  actual.from_collection_mode === expected.from_collection_mode &&
  actual.from_generation === expected.from_generation &&
  actual.from_provider === expected.from_provider &&
  actual.id === expected.id &&
  actual.idempotency_key === expected.idempotency_key &&
  stableJson(actual.metadata) === stableJson(expected.metadata) &&
  actual.reason === expected.reason &&
  actual.to_collection_mode === expected.to_collection_mode &&
  actual.to_generation === expected.to_generation &&
  actual.to_provider === expected.to_provider

export const taxProviderQuotaMatches = (
  actual: TaxProviderQuotaRecord,
  expected: TaxProviderQuotaRecord
): boolean =>
  actual.id === expected.id &&
  stableJson(actual.metadata) === stableJson(expected.metadata) &&
  sameDate(actual.observed_at, expected.observed_at) &&
  actual.provider === expected.provider &&
  actual.quota === expected.quota &&
  actual.remaining === expected.remaining &&
  actual.source === expected.source &&
  actual.usage === expected.usage &&
  actual.usage_percent === expected.usage_percent

export const taxQuoteEvidenceMatches = (
  actual: TaxQuoteEvidenceRecord,
  expected: TaxQuoteEvidenceRecord
): boolean =>
  actual.amount_minor === expected.amount_minor &&
  actual.association_status === expected.association_status &&
  actual.calculation_id === expected.calculation_id &&
  actual.cart_id === expected.cart_id &&
  actual.collection_mode === expected.collection_mode &&
  actual.currency_code === expected.currency_code &&
  actual.fingerprint === expected.fingerprint &&
  actual.generation === expected.generation &&
  actual.id === expected.id &&
  sameDate(actual.last_verified_at, expected.last_verified_at) &&
  sameDate(actual.linked_at, expected.linked_at) &&
  stableJson(actual.metadata) === stableJson(expected.metadata) &&
  actual.order_id === expected.order_id &&
  actual.payment_intent_id === expected.payment_intent_id &&
  actual.provider === expected.provider &&
  actual.status === expected.status &&
  actual.tax_transaction_id === expected.tax_transaction_id
