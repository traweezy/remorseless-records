import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"

import { getCart, initiatePaymentSession } from "@/lib/cart/api"

export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<{ cartId: string }> }
): Promise<Response> => {
  try {
    noStore()
    const { cartId } = await params
    const body = (await request.json().catch(() => ({}))) as {
      provider_id?: string
    }

    const cart = await getCart(cartId)
    const cartTotal = Number(cart.total ?? 0)

    if (cartTotal <= 0) {
      return NextResponse.json(
        { error: "Cart total must be greater than zero." },
        { status: 400 }
      )
    }

    const session = await initiatePaymentSession(
      cartId,
      typeof body.provider_id === "string" ? body.provider_id : undefined,
      cart
    )

    return NextResponse.json(session)
  } catch (error) {
    console.error("Failed to initialize payment session", error)
    return NextResponse.json(
      { error: "Unable to initialize payment session." },
      { status: 500 }
    )
  }
}
