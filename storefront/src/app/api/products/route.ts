import { z } from "zod"

import { storeClient } from "@/lib/medusa"
import { mapStoreProductToSearchHit } from "@/lib/products/transformers"
import { PRODUCT_LIST_FIELDS } from "@/lib/data/products"
import { resolveRegionId } from "@/lib/regions"
import {
  enforceRateLimit,
  jsonApiError,
  jsonApiResponse,
} from "@/lib/security/route-guards"

const querySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    sort: z.enum(["newest", "title-asc", "title-desc"]).optional(),
    inStock: z.enum(["true", "false"]).optional(),
  })
  .strict()

export const GET = async (request: Request) => {
  const url = new URL(request.url)

  try {
    const rateLimited = enforceRateLimit(request, {
      key: "api:products",
      max: 180,
      windowMs: 60_000,
    })
    if (rateLimited) {
      return rateLimited
    }

    const parsedQuery = querySchema.safeParse(
      Object.fromEntries(url.searchParams.entries())
    )
    if (!parsedQuery.success) {
      return jsonApiError("Invalid products query.", 400)
    }

    const limit = parsedQuery.data.limit ?? 24
    const offset = parsedQuery.data.offset ?? 0
    const sortParam = parsedQuery.data.sort
    const inStockOnly = parsedQuery.data.inStock === "true"

    const regionId = await resolveRegionId()
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

    const { products, count } = await storeClient.product.list(options)

    const hits = products.map(mapStoreProductToSearchHit)
    const filteredHits = inStockOnly
      ? hits.filter((hit) => {
          const status =
            hit.stockStatus ?? (hit.defaultVariant?.inStock ? "in_stock" : "sold_out")
          return status !== "sold_out"
        })
      : hits

    const total =
      typeof count === "number"
        ? count
        : (options.offset as number) + filteredHits.length

    return jsonApiResponse({
      products,
      hits: filteredHits,
      offset: options.offset as number,
      total,
    })
  } catch {
    console.error("Product fallback endpoint failed")
    return jsonApiError("Unable to load products", 500)
  }
}
