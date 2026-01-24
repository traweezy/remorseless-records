import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"

import { addLineItem } from "@/lib/cart/api"

export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<{ cartId: string }> }
): Promise<Response> => {
  try {
    noStore()
    const { cartId } = await params
    const body = (await request.json()) as {
      variant_id?: string
      quantity?: number
    }

    if (!body?.variant_id || typeof body.variant_id !== "string") {
      return NextResponse.json(
        { error: "variant_id is required." },
        { status: 400 }
      )
    }

    const quantity = Math.max(1, Math.floor(Number(body.quantity ?? 1)))
    const cart = await addLineItem(cartId, body.variant_id, quantity)
    return NextResponse.json({ cart })
  } catch (error) {
    console.error("Failed to add line item", error)
    return NextResponse.json(
      { error: "Unable to add item to cart." },
      { status: 500 }
    )
  }
}
