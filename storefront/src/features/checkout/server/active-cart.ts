import "server-only"

import type { HttpTypes } from "@medusajs/types"
import type { NextRequest } from "next/server"

import { createCheckoutProjection } from "@/features/checkout/server/projection"
import { getCart } from "@/lib/cart/api"
import {
  clearCartCookie,
  readCartCookie,
  setCartCookie,
} from "@/lib/cart/cookie"
import { mapCartError } from "@/lib/cart/errors"
import { jsonApiProblem, jsonApiResponse } from "@/lib/security/route-guards"

export type ActiveCheckoutCart = {
  cart: HttpTypes.StoreCart
  needsCookieRotation: boolean
}

export type ActiveCheckoutCartResult =
  { ok: true; value: ActiveCheckoutCart } | { ok: false; response: Response }

export type CheckoutCartIdentityResult =
  | {
      ok: true
      value: { cartId: string; needsCookieRotation: boolean }
    }
  | { ok: false; response: Response }

const problem = (
  request: NextRequest,
  input: {
    status: number
    code: string
    title: string
    detail: string
  }
): Response =>
  jsonApiProblem({
    ...input,
    instance: request.nextUrl.pathname,
  })

export const resolveActiveCheckoutCart = async (
  request: NextRequest
): Promise<ActiveCheckoutCartResult> => {
  const identity = resolveCheckoutCartIdentity(request)
  if (!identity.ok) {
    return identity
  }

  try {
    const cart = await getCart(identity.value.cartId)
    if (cart.completed_at) {
      return {
        ok: false,
        response: problem(request, {
          status: 409,
          code: "cart_completed",
          title: "Cart already completed",
          detail: "This cart has already been submitted.",
        }),
      }
    }
    if (!cart.items?.length) {
      return {
        ok: false,
        response: clearCartCookie(
          problem(request, {
            status: 409,
            code: "cart_empty",
            title: "Cart is empty",
            detail: "Add an item before continuing to checkout.",
          })
        ),
      }
    }
    return {
      ok: true,
      value: {
        cart,
        needsCookieRotation: identity.value.needsCookieRotation,
      },
    }
  } catch (error: unknown) {
    const mapped = mapCartError(
      error,
      "Checkout is temporarily unavailable. Please try again."
    )
    const response = problem(request, {
      ...mapped,
      code: mapped.status === 404 ? "cart_missing" : mapped.code,
    })
    return {
      ok: false,
      response: mapped.status === 404 ? clearCartCookie(response) : response,
    }
  }
}

export const resolveCheckoutCartIdentity = (
  request: NextRequest
): CheckoutCartIdentityResult => {
  const cookie = readCartCookie(request)
  if (cookie.status !== "valid") {
    const response = problem(request, {
      status: 404,
      code: "cart_missing",
      title: "Cart not found",
      detail: "Add an item to your cart before starting checkout.",
    })
    return {
      ok: false,
      response:
        cookie.status === "invalid" ? clearCartCookie(response) : response,
    }
  }

  return {
    ok: true,
    value: {
      cartId: cookie.cartId,
      needsCookieRotation: cookie.needsRotation,
    },
  }
}

export const checkoutProjectionResponse = (
  active: ActiveCheckoutCart,
  options: { includeClientSecret?: boolean } = {}
): Response => {
  const response = jsonApiResponse({
    checkout: createCheckoutProjection(active.cart, options),
  })
  return active.needsCookieRotation
    ? setCartCookie(response, active.cart.id)
    : response
}
