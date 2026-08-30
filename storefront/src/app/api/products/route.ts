import type { HttpTypes } from "@medusajs/types"
import { z } from "zod"

import { mapStoreProductToSearchHit } from "@/lib/products/transformers"
import { PRODUCT_LIST_FIELDS } from "@/lib/data/products"
import { providerProblem } from "@/lib/http/provider-boundary"
import { correlatedMedusaFetch } from "@/lib/medusa/correlated-client"
import { resolveRegionId } from "@/lib/regions"
import { SEARCH_MAX_LIMIT, SEARCH_MAX_RESULT_WINDOW } from "@/lib/search/search"
import {
  enforceRateLimit,
  jsonApiError,
  jsonApiResponse,
} from "@/lib/security/route-guards"

const querySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(SEARCH_MAX_LIMIT).optional(),
    offset: z.coerce
      .number()
      .int()
      .min(0)
      .max(SEARCH_MAX_RESULT_WINDOW - 1)
      .optional(),
    sort: z.enum(["newest", "title-asc", "title-desc"]).optional(),
    inStock: z.enum(["true", "false"]).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.limit ?? 24) + (value.offset ?? 0) > SEARCH_MAX_RESULT_WINDOW) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["offset"],
        message: `Product results are limited to the first ${SEARCH_MAX_RESULT_WINDOW} matches`,
      })
    }
  })

export const GET = async (request: Request) => {
  const url = new URL(request.url)

  try {
    const rateLimited = await enforceRateLimit(request, {
      key: "api:products",
      max: 180,
      windowMs: 60_000,
      onUnavailable: "local-fallback",
    })
    if (rateLimited) {
      return rateLimited
    }

    const parsedQuery = querySchema.safeParse(
      Object.fromEntries(url.searchParams.entries())
    )
    if (!parsedQuery.success) {
      return jsonApiError(
        request,
        "Invalid products query.",
        400,
        "invalid_query"
      )
    }

    const limit = parsedQuery.data.limit ?? 24
    const offset = parsedQuery.data.offset ?? 0
    const sortParam = parsedQuery.data.sort
    const inStockOnly = parsedQuery.data.inStock === "true"

    const regionId = await resolveRegionId(request)
    const options: Record<string, unknown> = {
      limit,
      offset,
      fields: PRODUCT_LIST_FIELDS,
      region_id: regionId,
    }

    if (typeof sortParam === "string") {
      const normalized = sortParam.toLowerCase()
      if (normalized === "newest") {
        options.order = "-created_at"
      } else if (normalized === "title-asc") {
        options.order = "title"
      } else if (normalized === "title-desc") {
        options.order = "-title"
      }
    }

    const { products, count } =
      await correlatedMedusaFetch<HttpTypes.StoreProductListResponse>(
        request,
        "/store/products",
        { query: options }
      )

    const hits = products.map(mapStoreProductToSearchHit)
    const filteredHits = inStockOnly
      ? hits.filter((hit) => {
          const status =
            hit.stockStatus ??
            (hit.defaultVariant?.inStock ? "in_stock" : "sold_out")
          return status !== "sold_out"
        })
      : hits

    const total = Math.min(
      typeof count === "number"
        ? count
        : (options.offset as number) + filteredHits.length,
      SEARCH_MAX_RESULT_WINDOW
    )

    return jsonApiResponse({
      products,
      hits: filteredHits,
      offset: options.offset as number,
      total,
    })
  } catch (error) {
    console.error("Product fallback endpoint failed")
    const problem = providerProblem(error, "catalog")
    if (problem) {
      return jsonApiError(request, problem.detail, problem.status, problem.code)
    }
    return jsonApiError(
      request,
      "Unable to load products",
      500,
      "catalog_unavailable"
    )
  }
}
