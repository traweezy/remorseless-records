import { NextResponse } from "next/server"

import { searchProductsServer } from "@/lib/search/server"
import type { ProductSearchRequest } from "@/lib/search/search"

const normalizeRequest = (payload: Partial<ProductSearchRequest>): ProductSearchRequest => {
  const query = typeof payload.query === "string" ? payload.query : ""
  const limit = typeof payload.limit === "number" && Number.isFinite(payload.limit)
    ? Math.max(1, Math.min(payload.limit, 200))
    : 24
  const offset = typeof payload.offset === "number" && Number.isFinite(payload.offset)
    ? Math.max(0, payload.offset)
    : 0
  const sort = payload.sort ?? "title-asc"
  const filters = payload.filters ?? {}
  const inStockOnly = Boolean(payload.inStockOnly)

  return {
    query,
    limit,
    offset,
    sort,
    filters,
    inStockOnly,
  }
}

export const POST = async (request: Request) => {
  try {
    const body = (await request.json()) as Partial<ProductSearchRequest>
    const normalized = normalizeRequest(body)
    const response = await searchProductsServer(normalized)
    return NextResponse.json(response)
  } catch (error) {
    console.error("/api/search/products failed", error)
    return NextResponse.json({ error: "Unable to perform search" }, { status: 500 })
  }
}
