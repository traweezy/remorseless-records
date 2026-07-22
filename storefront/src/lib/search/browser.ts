"use client"

import type {
  ProductSearchRequest,
  ProductSearchResponse,
} from "@/lib/search/search"

type SearchProductsBrowserOptions = {
  signal?: AbortSignal
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

const parseSearchResponse = (value: unknown): ProductSearchResponse => {
  if (
    !isRecord(value) ||
    !Array.isArray(value.hits) ||
    typeof value.total !== "number" ||
    !Number.isFinite(value.total) ||
    typeof value.offset !== "number" ||
    !Number.isFinite(value.offset) ||
    !isRecord(value.facets)
  ) {
    throw new Error("Catalog search returned an invalid response.")
  }

  return value as ProductSearchResponse
}

export const searchProductsBrowser = async (
  request: ProductSearchRequest,
  options?: SearchProductsBrowserOptions
): Promise<ProductSearchResponse> => {
  const response = await fetch("/api/search/products", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
    ...(options?.signal ? { signal: options.signal } : {}),
  })

  if (!response.ok) {
    throw new Error(`Catalog search failed with status ${response.status}.`)
  }

  return parseSearchResponse(await response.json())
}
