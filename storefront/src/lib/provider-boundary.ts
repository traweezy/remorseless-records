export type UnknownRecord = Record<string, unknown>

const DECIMAL_LITERAL =
  /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/
const INTEGER_LITERAL = /^[+-]?(?:0|[1-9]\d*)$/
const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/

export const asUnknownRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null

const explicitValue = (value: unknown): unknown => {
  const wrapper = asUnknownRecord(value)
  return wrapper && Object.hasOwn(wrapper, "value") ? wrapper.value : value
}

export const readFiniteNumber = (value: unknown): number | null => {
  const candidate = explicitValue(value)
  if (typeof candidate === "number") {
    return Number.isFinite(candidate) ? candidate : null
  }
  if (typeof candidate !== "string") {
    return null
  }
  const normalized = candidate.trim()
  if (!normalized || !DECIMAL_LITERAL.test(normalized)) {
    return null
  }
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

export const readSafeInteger = (value: unknown): number | null => {
  const candidate = explicitValue(value)
  if (typeof candidate === "number") {
    return Number.isSafeInteger(candidate) ? candidate : null
  }
  if (typeof candidate !== "string") {
    return null
  }
  const normalized = candidate.trim()
  if (!INTEGER_LITERAL.test(normalized)) {
    return null
  }
  const parsed = Number(normalized)
  return Number.isSafeInteger(parsed) ? parsed : null
}

export const readNonNegativeSafeInteger = (value: unknown): number | null => {
  const parsed = readSafeInteger(value)
  return parsed !== null && parsed >= 0 ? parsed : null
}

export const readPositiveSafeInteger = (value: unknown): number | null => {
  const parsed = readSafeInteger(value)
  return parsed !== null && parsed > 0 ? parsed : null
}

export const readBoundedText = (
  value: unknown,
  maxLength = 255
): string | null => {
  if (typeof value !== "string") {
    return null
  }
  const normalized = value.trim()
  return normalized && normalized.length <= maxLength ? normalized : null
}

export const readRecordArray = (
  value: unknown,
  options: { optional?: boolean } = {}
): UnknownRecord[] | null => {
  if (options.optional === true && (value === null || value === undefined)) {
    return []
  }
  if (!Array.isArray(value)) {
    return null
  }
  const records: UnknownRecord[] = []
  for (const entry of value) {
    const record = asUnknownRecord(entry)
    if (!record) {
      return null
    }
    records.push(record)
  }
  return records
}

export const readIsoTimestamp = (value: unknown): string | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }
  if (typeof value !== "string") {
    return null
  }
  const normalized = value.trim()
  if (!ISO_TIMESTAMP.test(normalized)) {
    return null
  }
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}
