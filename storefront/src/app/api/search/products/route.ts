import { z } from "zod"

import { searchProductsServer } from "@/lib/search/server"
import type {
  ProductSearchFilters,
  ProductSearchRequest,
} from "@/lib/search/search"
import {
  enforceRateLimit,
  enforceTrustedOrigin,
  jsonApiError,
  jsonApiResponse,
  parseJsonBody,
} from "@/lib/security/route-guards"

const searchRequestSchema = z
  .object({
    query: z.string().max(160).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    sort: z
      .enum(["title-asc", "title-desc", "newest", "price-low", "price-high"])
      .optional(),
    inStockOnly: z.boolean().optional(),
    filters: z
      .object({
        genres: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
        formats: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
        categories: z.array(z.string().trim().min(1).max(160)).max(40).optional(),
        variants: z.array(z.string().trim().min(1).max(160)).max(40).optional(),
        productTypes: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

const sanitizeFilters = (
  filters: z.infer<typeof searchRequestSchema>["filters"]
): ProductSearchRequest["filters"] => {
  const sanitized: ProductSearchFilters = {
    ...(filters?.genres?.length ? { genres: filters.genres } : {}),
    ...(filters?.formats?.length ? { formats: filters.formats } : {}),
    ...(filters?.categories?.length ? { categories: filters.categories } : {}),
    ...(filters?.variants?.length ? { variants: filters.variants } : {}),
    ...(filters?.productTypes?.length ? { productTypes: filters.productTypes } : {}),
  }

  const hasAnyFilters =
    Boolean(sanitized.genres?.length) ||
    Boolean(sanitized.formats?.length) ||
    Boolean(sanitized.categories?.length) ||
    Boolean(sanitized.variants?.length) ||
    Boolean(sanitized.productTypes?.length)

  return hasAnyFilters ? sanitized : undefined
}

const normalizeRequest = (
  payload: z.infer<typeof searchRequestSchema>
): ProductSearchRequest => {
  const query = typeof payload.query === "string" ? payload.query : ""
  const limit = typeof payload.limit === "number" && Number.isFinite(payload.limit)
    ? Math.max(1, Math.min(payload.limit, 200))
    : 24
  const offset = typeof payload.offset === "number" && Number.isFinite(payload.offset)
    ? Math.max(0, payload.offset)
    : 0
  const sort = payload.sort ?? "title-asc"
  const filters = sanitizeFilters(payload.filters)
  const inStockOnly = Boolean(payload.inStockOnly)

  return {
    query,
    limit,
    offset,
    sort,
    inStockOnly,
    ...(filters ? { filters } : {}),
  }
}

export const POST = async (request: Request) => {
  try {
    const rateLimited = enforceRateLimit(request, {
      key: "api:search:products",
      max: 120,
      windowMs: 60_000,
    })
    if (rateLimited) {
      return rateLimited
    }

    const originCheck = enforceTrustedOrigin(request)
    if (originCheck) {
      return originCheck
    }

    const parsed = await parseJsonBody(request, searchRequestSchema, {
      maxBytes: 24 * 1024,
    })
    if (!parsed.ok) {
      return parsed.response
    }

    const normalized = normalizeRequest(parsed.data)
    const response = await searchProductsServer(normalized)
    return jsonApiResponse(response)
  } catch {
    console.error("/api/search/products failed")
    return jsonApiError("Unable to perform search", 500)
  }
}
