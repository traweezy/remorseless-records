import "server-only"

import type { NextRequest } from "next/server"

import { clearCartCookie, readCartCookie } from "@/lib/cart/cookie"
import { createCart } from "@/lib/cart/api"
import { jsonApiProblem } from "@/lib/security/route-guards"

export const readActiveCartId = (request: NextRequest): string | Response => {
  const cookie = readCartCookie(request)
  if (cookie.status === "valid") {
    return cookie.cartId
  }

  const response = jsonApiProblem({
    status: 409,
    code: "cart_session_missing",
    title: "Cart session missing",
    detail: "Refresh the cart before trying that update again.",
  })
  return cookie.status === "invalid" ? clearCartCookie(response) : response
}

export const readOrCreateCartId = async (
  request: NextRequest
): Promise<{ cartId: string; created: boolean }> => {
  const cookie = readCartCookie(request)
  if (cookie.status === "valid") {
    return { cartId: cookie.cartId, created: false }
  }

  const cart = await createCart()
  return { cartId: cart.id, created: true }
}
