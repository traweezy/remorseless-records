"use client"

import type {
  CatalogFilterKind,
  CatalogFilterOption,
  CatalogFilterOptionsResponse,
  CatalogPriceRangeResponse,
} from "@/lib/catalog/filters"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

const parseFilterOptions = (value: unknown): CatalogFilterOption[] => {
  if (!isRecord(value) || !Array.isArray(value.options)) {
    throw new Error("Catalog filters returned an invalid response.")
  }

  return value.options.map((option) => {
    if (
      !isRecord(option) ||
      typeof option.value !== "string" ||
      typeof option.label !== "string" ||
      typeof option.count !== "number" ||
      !Number.isFinite(option.count)
    ) {
      throw new Error("Catalog filters returned an invalid option.")
    }
    return {
      value: option.value,
      label: option.label,
      count: option.count,
    }
  })
}

export const fetchCatalogFilterOptions = async (
  kind: CatalogFilterKind,
  options?: { signal?: AbortSignal }
): Promise<CatalogFilterOptionsResponse> => {
  const response = await fetch(`/api/catalog/filters/${kind}`, {
    headers: { Accept: "application/json" },
    ...(options?.signal ? { signal: options.signal } : {}),
  })
  if (!response.ok) {
    throw new Error(
      `Catalog ${kind} filters failed with status ${response.status}.`
    )
  }
  return { options: parseFilterOptions(await response.json()) }
}

export const fetchCatalogPriceRange = async (options?: {
  signal?: AbortSignal
}): Promise<CatalogPriceRangeResponse> => {
  const response = await fetch("/api/catalog/filters/price-range", {
    headers: { Accept: "application/json" },
    ...(options?.signal ? { signal: options.signal } : {}),
  })
  if (!response.ok) {
    throw new Error(
      `Catalog price range failed with status ${response.status}.`
    )
  }

  const payload: unknown = await response.json()
  if (!isRecord(payload) || !isRecord(payload.range)) {
    throw new Error("Catalog price range returned an invalid response.")
  }

  const { min, max, currency } = payload.range
  if (
    typeof min !== "number" ||
    !Number.isFinite(min) ||
    typeof max !== "number" ||
    !Number.isFinite(max) ||
    max < min ||
    typeof currency !== "string" ||
    !currency.trim().length
  ) {
    throw new Error("Catalog price range returned invalid values.")
  }

  return {
    range: { min, max, currency: currency.trim().toLowerCase() },
  }
}
