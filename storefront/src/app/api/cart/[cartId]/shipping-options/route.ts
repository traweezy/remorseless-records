import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"

import { listShippingOptions } from "@/lib/cart/api"

export const GET = async (
  _request: NextRequest,
  { params }: { params: Promise<{ cartId: string }> }
): Promise<Response> => {
  try {
    noStore()
    const { cartId } = await params
    const response = await listShippingOptions(cartId)
    return NextResponse.json({ shipping_options: response.shipping_options ?? [] })
  } catch (error) {
    console.error("Failed to load shipping options", error)
    return NextResponse.json(
      { error: "Unable to load shipping options." },
      { status: 500 }
    )
  }
}
