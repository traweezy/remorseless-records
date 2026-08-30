import type { JsonList, JsonRecord } from "../../modules/catalog/serializers"

export const slugifyCatalogValue = (
  value: string,
  fallback = "catalog"
): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")

  return normalized.length ? normalized : fallback
}

export const normalizeCatalogList = (values?: string[] | null): string[] =>
  (values ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

export const toCatalogNullableString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

export const toCatalogOptionalDate = (value: unknown): Date | null => {
  if (!value || typeof value !== "string") {
    return null
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export const toCatalogOptionalInteger = (
  value: number | null | undefined
): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null

export const coerceCatalogJsonRecord = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {}

export const coerceCatalogJsonList = (value: unknown): JsonList =>
  Array.isArray(value) ? value : []

export const firstCatalogResult = <T>(value: T | T[]): T | undefined =>
  Array.isArray(value) ? value[0] : value
