import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

import { storeClient } from "@/lib/medusa"
import { PRODUCT_DETAIL_FIELDS } from "@/lib/data/products"
import { resolveRegionId } from "@/lib/regions"

type RouteParams = {
  params: Promise<{
    handle: string
  }>
}

export const GET = async (
  _request: NextRequest,
  { params }: RouteParams
): Promise<Response> => {
  const { handle: rawHandle } = await params
  const handle = rawHandle?.trim()

  if (!handle) {
    return NextResponse.json(
      { error: "Product handle is required" },
      { status: 400 }
    )
  }

  try {
    const regionId = await resolveRegionId()
    const { products } = await storeClient.product.list({
      handle,
      limit: 1,
      fields: PRODUCT_DETAIL_FIELDS,
      region_id: regionId,
    })

    const product = products[0]

    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 })
    }

    return NextResponse.json({ product })
  } catch (error) {
    console.error("Failed to load product for quick shop", error)
    return NextResponse.json(
      { error: "Unable to load product" },
      { status: 500 }
    )
  }
}
