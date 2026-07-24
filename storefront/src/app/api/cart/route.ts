import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"

import { getCart } from "@/lib/cart/api"
import {
  clearCartCookie,
  readCartCookie,
  setCartCookie,
} from "@/lib/cart/cookie"
import { mapCartError } from "@/lib/cart/errors"
import { enforceCartRateLimit } from "@/lib/security/cart-rate-limit"
import {
  enforceTrustedOrigin,
  jsonApiProblem,
  jsonApiResponse,
} from "@/lib/security/route-guards"

export const GET = async (request: NextRequest): Promise<Response> => {
  noStore()
  const rateLimited = await enforceCartRateLimit(request, {
    key: "api:cart:get",
    max: 180,
    windowMs: 60_000,
  })
  if (rateLimited) {
    return rateLimited
  }

  const cookie = readCartCookie(request)
  if (cookie.status !== "valid") {
    const response = jsonApiResponse({ cart: null })
    return cookie.status === "invalid" ? clearCartCookie(response) : response
  }

  try {
    const cart = await getCart(cookie.cartId)
    const response = jsonApiResponse({ cart })
    return cookie.needsRotation ? setCartCookie(response, cart.id) : response
  } catch (error: unknown) {
    const problem = mapCartError(
      error,
      "Unable to retrieve the cart right now."
    )
    if (problem.status === 404) {
      return clearCartCookie(jsonApiResponse({ cart: null }))
    }

    console.error("Failed to retrieve cart", { code: problem.code })
    return jsonApiProblem({
      ...problem,
      instance: request.nextUrl.pathname,
    })
  }
}

export const DELETE = async (request: NextRequest): Promise<Response> => {
  noStore()
  const rateLimited = await enforceCartRateLimit(request, {
    key: "api:cart:clear",
    max: 30,
    windowMs: 60_000,
  })
  if (rateLimited) {
    return rateLimited
  }

  const originCheck = enforceTrustedOrigin(request)
  if (originCheck) {
    return originCheck
  }

  return clearCartCookie(jsonApiResponse({ cart: null }))
}
