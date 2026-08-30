import { asUnknownRecord } from "./records"

const DECIMAL_LITERAL =
  /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/
const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/

export const readFiniteNumber = (value: unknown): number | null => {
  const wrapper = asUnknownRecord(value)
  const candidate =
    wrapper && Object.hasOwn(wrapper, "value") ? wrapper.value : value
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

export const readNonNegativeSafeInteger = (value: unknown): number | null => {
  const parsed = readFiniteNumber(value)
  return parsed !== null && Number.isSafeInteger(parsed) && parsed >= 0
    ? parsed
    : null
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
