import { NextResponse } from "next/server"

import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"

import { CART_COOKIE, getCartById } from "@/lib/cart"

export const GET = async (request: NextRequest): Promise<Response> => {
  try {
    if (process.env.NEXT_PHASE === "phase-production-build") {
      return NextResponse.json({ cart: null })
    }
    noStore()
    const cartId = request.cookies.get(CART_COOKIE)?.value
    const cart = cartId ? await getCartById(cartId) : null
    return NextResponse.json({ cart })
  } catch (error) {
    console.error("Failed to load cart", error)
    return NextResponse.json(
      { error: "Unable to retrieve cart at this time." },
      { status: 500 }
    )
  }
}
