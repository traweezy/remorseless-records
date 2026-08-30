import { z } from "zod"

import { providerProblem } from "@/lib/http/provider-boundary"
import { searchProductsServer } from "@/lib/search/server"
import {
  CATALOG_PAGE_SIZE,
  SEARCH_MAX_LIMIT,
  SEARCH_MAX_RESULT_WINDOW,
  type ProductSearchFilters,
  type ProductSearchRequest,
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
    limit: z.coerce.number().int().min(1).max(SEARCH_MAX_LIMIT).optional(),
    offset: z.coerce
      .number()
      .int()
      .min(0)
      .max(SEARCH_MAX_RESULT_WINDOW - 1)
      .optional(),
    sort: z
      .enum([
        "artist-asc",
        "artist-desc",
        "title-asc",
        "title-desc",
        "newest",
        "price-low",
        "price-high",
      ])
      .optional(),
    inStockOnly: z.boolean().optional(),
    filters: z
      .object({
        genres: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
        formats: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
        categories: z
          .array(z.string().trim().min(1).max(160))
          .max(40)
          .optional(),
        variants: z.array(z.string().trim().min(1).max(160)).max(40).optional(),
        productTypes: z
          .array(z.string().trim().min(1).max(120))
          .max(20)
          .optional(),
        availability: z
          .array(z.string().trim().min(1).max(80))
          .max(20)
          .optional(),
        price: z
          .object({
            min: z.coerce.number().int().min(0).max(1_000_000).optional(),
            max: z.coerce.number().int().min(0).max(1_000_000).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const limit = value.limit ?? 24
    const offset = value.offset ?? 0
    if (limit + offset > SEARCH_MAX_RESULT_WINDOW) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["offset"],
        message: `Search results are limited to the first ${SEARCH_MAX_RESULT_WINDOW} matches`,
      })
    }
    const min = value.filters?.price?.min
    const max = value.filters?.price?.max
    if (typeof min === "number" && typeof max === "number" && min > max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["filters", "price"],
        message: "Minimum price cannot be greater than maximum price",
      })
    }
  })

const sanitizeFilters = (
  filters: z.infer<typeof searchRequestSchema>["filters"]
): ProductSearchRequest["filters"] => {
  const price =
    filters?.price &&
    (typeof filters.price.min === "number" ||
      typeof filters.price.max === "number")
      ? {
          ...(typeof filters.price.min === "number"
            ? { min: filters.price.min }
            : {}),
          ...(typeof filters.price.max === "number"
            ? { max: filters.price.max }
            : {}),
        }
      : undefined

  const sanitized: ProductSearchFilters = {
    ...(filters?.genres?.length ? { genres: filters.genres } : {}),
    ...(filters?.formats?.length ? { formats: filters.formats } : {}),
    ...(filters?.categories?.length ? { categories: filters.categories } : {}),
    ...(filters?.variants?.length ? { variants: filters.variants } : {}),
    ...(filters?.productTypes?.length
      ? { productTypes: filters.productTypes }
      : {}),
    ...(filters?.availability?.length
      ? { availability: filters.availability }
      : {}),
    ...(price ? { price } : {}),
  }

  const hasAnyFilters =
    Boolean(sanitized.genres?.length) ||
    Boolean(sanitized.formats?.length) ||
    Boolean(sanitized.categories?.length) ||
    Boolean(sanitized.variants?.length) ||
    Boolean(sanitized.productTypes?.length) ||
    Boolean(sanitized.availability?.length) ||
    Boolean(sanitized.price)

  return hasAnyFilters ? sanitized : undefined
}

const normalizeRequest = (
  payload: z.infer<typeof searchRequestSchema>
): ProductSearchRequest => {
  const query = typeof payload.query === "string" ? payload.query : ""
  const limit =
    typeof payload.limit === "number" && Number.isFinite(payload.limit)
      ? Math.max(1, Math.min(payload.limit, SEARCH_MAX_LIMIT))
      : Math.min(24, CATALOG_PAGE_SIZE)
  const offset =
    typeof payload.offset === "number" && Number.isFinite(payload.offset)
      ? Math.max(0, Math.min(payload.offset, SEARCH_MAX_RESULT_WINDOW - limit))
      : 0
  const sort = payload.sort ?? "newest"
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
    const rateLimited = await enforceRateLimit(request, {
      key: "api:search:products",
      max: 120,
      windowMs: 60_000,
      onUnavailable: "local-fallback",
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
    const response = await searchProductsServer(normalized, request.signal)
    return jsonApiResponse(response)
  } catch (error) {
    console.error("/api/search/products failed")
    const problem = providerProblem(error, "search")
    if (problem) {
      return jsonApiError(request, problem.detail, problem.status, problem.code)
    }
    return jsonApiError(
      request,
      "Unable to perform search",
      500,
      "search_unavailable"
    )
  }
}
