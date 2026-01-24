import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"

import { addShippingMethod } from "@/lib/cart/api"

export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<{ cartId: string }> }
): Promise<Response> => {
  try {
    noStore()
    const { cartId } = await params
    const body = (await request.json()) as { option_id?: string }

    if (!body?.option_id || typeof body.option_id !== "string") {
      return NextResponse.json(
        { error: "option_id is required." },
        { status: 400 }
      )
    }

    const cart = await addShippingMethod(cartId, body.option_id)
    return NextResponse.json({ cart })
  } catch (error) {
    console.error("Failed to add shipping method", error)
    return NextResponse.json(
      { error: "Unable to add shipping method." },
      { status: 500 }
    )
  }
}
