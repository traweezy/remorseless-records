import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"

import { completeCart } from "@/lib/cart/api"

export const POST = async (
  _request: NextRequest,
  { params }: { params: Promise<{ cartId: string }> }
): Promise<Response> => {
  try {
    noStore()
    const { cartId } = await params
    const response = await completeCart(cartId)
    return NextResponse.json(response)
  } catch (error) {
    console.error("Failed to complete cart", error)
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Unable to complete cart."
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
