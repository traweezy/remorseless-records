import { NextResponse } from "next/server"

import type { HttpTypes } from "@medusajs/types"

import { storeClient } from "@/lib/medusa"
import { mapStoreProductToSearchHit } from "@/lib/products/transformers"

export const GET = async (request: Request) => {
  const url = new URL(request.url)
  const limitParam = url.searchParams.get("limit")
  const limit = limitParam ? Number.parseInt(limitParam, 10) : 24

  try {
    const { products } = await storeClient.product.list({
      limit: Number.isFinite(limit) && limit > 0 ? limit : 24,
    })

    return NextResponse.json({
      products,
      hits: products.map(mapStoreProductToSearchHit),
    })
  } catch (error) {
    console.error("Product fallback endpoint failed", error)
    return NextResponse.json(
      { error: "Unable to load products" },
      { status: 500 }
    )
  }
}
