import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"

import { checkoutContactSchema } from "@/features/checkout/schemas/checkout"
import {
  checkoutProjectionResponse,
  resolveActiveCheckoutCart,
} from "@/features/checkout/server/active-cart"
import { checkoutOperationError } from "@/features/checkout/server/errors"
import { guardCheckoutMutation } from "@/features/checkout/server/guards"
import { setCartEmail } from "@/lib/cart/api"
import { parseJsonBody } from "@/lib/security/route-guards"

export const PUT = async (request: NextRequest): Promise<Response> => {
  noStore()
  const guarded = await guardCheckoutMutation(request, {
    key: "contact",
    max: 30,
  })
  if (guarded) {
    return guarded
  }

  const parsed = await parseJsonBody(request, checkoutContactSchema, {
    maxBytes: 2 * 1024,
  })
  if (!parsed.ok) {
    return parsed.response
  }

  const active = await resolveActiveCheckoutCart(request)
  if (!active.ok) {
    return active.response
  }

  try {
    const cart = await setCartEmail(
      active.value.cart.id,
      parsed.data.email,
      request
    )
    return checkoutProjectionResponse({
      cart,
      needsCookieRotation: active.value.needsCookieRotation,
    })
  } catch (error: unknown) {
    return checkoutOperationError(request, error, {
      code: "contact_invalid",
      title: "Contact details were not saved",
      detail: "Check your email address and try again.",
    })
  }
}
