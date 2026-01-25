import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"

import { getCart, initiatePaymentSession } from "@/lib/cart/api"

export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<{ cartId: string }> }
): Promise<Response> => {
  let cart: Awaited<ReturnType<typeof getCart>> | null = null
  try {
    noStore()
    const { cartId } = await params
    const body = (await request.json().catch(() => ({}))) as {
      provider_id?: string
    }

    cart = await getCart(cartId)
    const cartTotal = Number(cart.total ?? 0)
    const LARGE_TOTAL_THRESHOLD = 1000 * 100

    if (cartTotal >= LARGE_TOTAL_THRESHOLD) {
      console.warn("[checkout] High cart total when creating payment session", {
        cartId,
        total: cartTotal,
        currency: cart.currency_code ?? "usd",
        itemCount: cart.items?.length ?? 0,
        subtotal: cart.subtotal ?? 0,
        taxTotal: cart.tax_total ?? 0,
        shippingSubtotal: cart.shipping_subtotal ?? 0,
        discountTotal: cart.discount_total ?? 0,
      })
    }

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
    if (cart) {
      console.warn("[checkout] Payment session init failed", {
        cartId: cart.id,
        total: cart.total ?? 0,
        currency: cart.currency_code ?? "usd",
        itemCount: cart.items?.length ?? 0,
        subtotal: cart.subtotal ?? 0,
        taxTotal: cart.tax_total ?? 0,
        shippingSubtotal: cart.shipping_subtotal ?? 0,
        discountTotal: cart.discount_total ?? 0,
      })
    }
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Unable to initialize payment session."
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
