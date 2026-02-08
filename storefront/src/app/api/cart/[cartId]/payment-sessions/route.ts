import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"
import { z } from "zod"

import { getCart, initiatePaymentSession } from "@/lib/cart/api"
import {
  enforceRateLimit,
  enforceTrustedOrigin,
  jsonApiError,
  jsonApiResponse,
  parseJsonBody,
} from "@/lib/security/route-guards"

const paymentSessionSchema = z
  .object({
    provider_id: z.string().trim().min(1).optional(),
  })
  .strict()

export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<{ cartId: string }> }
): Promise<Response> => {
  let cart: Awaited<ReturnType<typeof getCart>> | null = null
  try {
    noStore()
    const rateLimited = enforceRateLimit(request, {
      key: "api:cart:payment-session",
      max: 45,
      windowMs: 60_000,
    })
    if (rateLimited) {
      return rateLimited
    }

    const originCheck = enforceTrustedOrigin(request)
    if (originCheck) {
      return originCheck
    }

    const { cartId } = await params
    const parsed = await parseJsonBody(request, paymentSessionSchema, {
      maxBytes: 2 * 1024,
      requireJsonContentType: false,
    })
    if (!parsed.ok) {
      return parsed.response
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
      parsed.data.provider_id,
      cart
    )

    return jsonApiResponse(session)
  } catch {
    console.error("Failed to initialize payment session")
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
    return jsonApiError("Unable to initialize payment session.", 500)
  }
}
