import { createHash } from "node:crypto"

export const LEGACY_MINOR_UNIT_FACTOR = 100

export type MonetaryUnitMode = "legacy_minor" | "major"

export type MonetaryRecordSource =
  | "active_product_price"
  | "active_incomplete_cart_compare_price"
  | "active_incomplete_cart_line_price"
  | "active_incomplete_cart_shipping_price"
  | "calculated_shipping_option_data"
  | "shipping_option_price"
  | "transactional_record"

export type MonetaryAuditAction =
  | "convert_legacy_minor_to_major"
  | "manual_review"
  | "preserve_major"

export type MonetaryAuditInput = {
  amount: number
  currencyCode: string | null
  id: string
  source: MonetaryRecordSource
}

export type MonetaryAuditRecord = MonetaryAuditInput & {
  action: MonetaryAuditAction
  proposedMajorAmount: number | null
}

export type MonetaryAuditSummary = {
  bySource: Partial<Record<MonetaryRecordSource, number>>
  manifestSha256: string
  manualReviewRecords: number
  mode: MonetaryUnitMode
  preservedRecords: number
  proposedConversions: number
  totalRecords: number
}

const conversionSources = new Set<MonetaryRecordSource>([
  "active_product_price",
  "active_incomplete_cart_compare_price",
  "active_incomplete_cart_line_price",
  "active_incomplete_cart_shipping_price",
  "calculated_shipping_option_data",
])

const zeroAllowedSources = new Set<MonetaryRecordSource>([
  "active_incomplete_cart_compare_price",
  "active_incomplete_cart_shipping_price",
  "calculated_shipping_option_data",
])

export const parseDatabaseAmount = (value: unknown): number => {
  const amount =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : Number.NaN

  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`[money-audit] Invalid non-negative amount: ${String(value)}`)
  }

  return amount
}

const normalizeInput = (input: MonetaryAuditInput): MonetaryAuditInput => {
  const id = input.id.trim()
  if (!id) {
    throw new Error("[money-audit] Monetary record id cannot be empty.")
  }

  const currencyCode = input.currencyCode?.trim().toLowerCase() || null

  return {
    ...input,
    amount: parseDatabaseAmount(input.amount),
    currencyCode,
    id,
  }
}

export const auditMonetaryRecord = (
  input: MonetaryAuditInput,
  mode: MonetaryUnitMode = "legacy_minor"
): MonetaryAuditRecord => {
  const record = normalizeInput(input)

  if (mode === "major" || record.source === "shipping_option_price") {
    return {
      ...record,
      action: "preserve_major",
      proposedMajorAmount: record.amount,
    }
  }

  if (record.source === "transactional_record") {
    return {
      ...record,
      action: "manual_review",
      proposedMajorAmount: null,
    }
  }

  const isValidLegacyMinorAmount =
    conversionSources.has(record.source) &&
    Number.isSafeInteger(record.amount) &&
    (record.amount > 0 || zeroAllowedSources.has(record.source))

  if (!isValidLegacyMinorAmount) {
    return {
      ...record,
      action: "manual_review",
      proposedMajorAmount: null,
    }
  }

  return {
    ...record,
    action: "convert_legacy_minor_to_major",
    proposedMajorAmount: record.amount / LEGACY_MINOR_UNIT_FACTOR,
  }
}

const manifestLine = (record: MonetaryAuditRecord): string =>
  [
    record.source,
    record.id,
    record.currencyCode ?? "",
    record.amount.toString(),
    record.action,
    record.proposedMajorAmount?.toString() ?? "",
  ].join("\t")

export const buildMonetaryAuditSummary = (
  inputs: MonetaryAuditInput[],
  mode: MonetaryUnitMode = "legacy_minor"
): MonetaryAuditSummary => {
  const records = inputs.map((input) => auditMonetaryRecord(input, mode))
  const identities = new Set<string>()
  const sourcesById = new Map<string, MonetaryRecordSource>()
  const bySource: Partial<Record<MonetaryRecordSource, number>> = {}

  for (const record of records) {
    const identity = `${record.source}:${record.id}`
    if (identities.has(identity)) {
      throw new Error(`[money-audit] Duplicate monetary record: ${identity}`)
    }
    identities.add(identity)
    const existingSource = sourcesById.get(record.id)
    if (existingSource && existingSource !== record.source) {
      throw new Error(
        `[money-audit] Monetary record ${record.id} appears in conflicting sources: ${existingSource}, ${record.source}.`
      )
    }
    sourcesById.set(record.id, record.source)
    bySource[record.source] = (bySource[record.source] ?? 0) + 1
  }

  const manifest = records.map(manifestLine).sort().join("\n")

  return {
    bySource,
    manifestSha256: createHash("sha256").update(manifest).digest("hex"),
    manualReviewRecords: records.filter(
      ({ action }) => action === "manual_review"
    ).length,
    mode,
    preservedRecords: records.filter(
      ({ action }) => action === "preserve_major"
    ).length,
    proposedConversions: records.filter(
      ({ action }) => action === "convert_legacy_minor_to_major"
    ).length,
    totalRecords: records.length,
  }
}
