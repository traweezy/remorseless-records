import { NextResponse } from "next/server"

import { backendBaseUrl, withBackendHeaders } from "@/config/backend"
import { mapStoreProductToSearchHit } from "@/lib/products/transformers"
import type { HttpTypes } from "@medusajs/types"

export const GET = async (request: Request) => {
  const url = new URL(request.url)
  const limitParam = url.searchParams.get("limit")
  const offsetParam = url.searchParams.get("offset")
  const sortParam = url.searchParams.get("sort")
  const searchParam = url.searchParams.get("q")
  const inStockParam = url.searchParams.get("inStock")
  const limit = limitParam ? Number.parseInt(limitParam, 10) : 24
  const offset = offsetParam ? Number.parseInt(offsetParam, 10) : 0
  const inStockOnly = inStockParam === "true"

  try {
    const options = {
      limit: Number.isFinite(limit) && limit > 0 ? limit : 24,
      offset: Number.isFinite(offset) && offset >= 0 ? offset : 0,
    }

    const order =
      typeof sortParam === "string"
        ? (() => {
            const normalized = sortParam.toLowerCase()
            if (normalized === "newest") {
              return "-created_at"
            }
            if (normalized === "title-asc") {
              return "title"
            }
            if (normalized === "title-desc") {
              return "-title"
            }
            return undefined
          })()
        : undefined

    const upstream = new URL(`${backendBaseUrl}/store/products`)
    upstream.searchParams.set("limit", String(options.limit))
    upstream.searchParams.set("offset", String(options.offset))
    if (order) {
      upstream.searchParams.set("order", order)
    }
    if (searchParam) {
      upstream.searchParams.set("q", searchParam)
    }

    const response = await fetch(upstream.toString(), {
      cache: "no-store",
      headers: withBackendHeaders(),
    })
    if (!response.ok) {
      throw new Error(`Upstream products error: ${response.status}`)
    }

    const payload = (await response.json()) as { products?: unknown[]; count?: number }
    const isStoreProduct = (value: unknown): value is HttpTypes.StoreProduct =>
      typeof value === "object" && value !== null && "handle" in value
    const products = (Array.isArray(payload.products) ? payload.products : []).filter(isStoreProduct)
    const count = typeof payload.count === "number" ? payload.count : undefined

    const hits = products.map(mapStoreProductToSearchHit)
    const filteredHits = inStockOnly
      ? hits.filter((hit) => {
          const status =
            hit.stockStatus ?? (hit.defaultVariant?.inStock ? "in_stock" : "sold_out")
          return status !== "sold_out"
        })
      : hits

    const total = typeof count === "number" ? count : options.offset + filteredHits.length

    return NextResponse.json({
      products,
      hits: filteredHits,
      offset: options.offset,
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
