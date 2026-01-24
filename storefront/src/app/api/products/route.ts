import { NextResponse } from "next/server"

import { storeClient } from "@/lib/medusa"
import { mapStoreProductToSearchHit } from "@/lib/products/transformers"
import { PRODUCT_LIST_FIELDS } from "@/lib/data/products"
import { resolveRegionId } from "@/lib/regions"

export const GET = async (request: Request) => {
  const url = new URL(request.url)
  const limitParam = url.searchParams.get("limit")
  const offsetParam = url.searchParams.get("offset")
  const sortParam = url.searchParams.get("sort")
  const inStockParam = url.searchParams.get("inStock")
  const limit = limitParam ? Number.parseInt(limitParam, 10) : 24
  const offset = offsetParam ? Number.parseInt(offsetParam, 10) : 0
  const inStockOnly = inStockParam === "true"

  try {
    const regionId = await resolveRegionId()
    const options: Record<string, unknown> = {
      limit: Number.isFinite(limit) && limit > 0 ? limit : 24,
      offset: Number.isFinite(offset) && offset >= 0 ? offset : 0,
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

    return NextResponse.json({
      products,
      hits: filteredHits,
      offset: options.offset as number,
      total,
    })
  } catch (error) {
    console.error("Product fallback endpoint failed", error)
    return NextResponse.json(
      { error: "Unable to load products" },
      { status: 500 }
    )
  }
}
