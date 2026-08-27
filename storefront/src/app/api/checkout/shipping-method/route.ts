import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"

import { checkoutShippingMethodSchema } from "@/features/checkout/schemas/checkout"
import {
  checkoutProjectionResponse,
  resolveActiveCheckoutCart,
} from "@/features/checkout/server/active-cart"
import { checkoutOperationError } from "@/features/checkout/server/errors"
import { guardCheckoutMutation } from "@/features/checkout/server/guards"
import {
  addShippingMethod,
  calculateTaxes,
  listShippingOptions,
} from "@/lib/cart/api"
import { jsonApiProblem, parseJsonBody } from "@/lib/security/route-guards"

export const PUT = async (request: NextRequest): Promise<Response> => {
  noStore()
  const guarded = await guardCheckoutMutation(request, {
    key: "shipping-method",
    max: 30,
  })
  if (guarded) {
    return guarded
  }

  const parsed = await parseJsonBody(request, checkoutShippingMethodSchema, {
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
    const available = await listShippingOptions(active.value.cart.id, request)
    const selected = available.shipping_options?.find(
      (option) =>
        option.id === parsed.data.option_id && !option.insufficient_inventory
    )
    if (!selected) {
      return jsonApiProblem({
        request,
        status: 409,
        code: "shipping_changed",
        title: "Delivery method changed",
        detail: "Choose an available delivery method before continuing.",
        instance: request.nextUrl.pathname,
      })
    }

    await addShippingMethod(active.value.cart.id, selected.id, request)
    const cart = await calculateTaxes(active.value.cart.id, request)
    return checkoutProjectionResponse({
      cart,
      needsCookieRotation: active.value.needsCookieRotation,
    })
  } catch (error: unknown) {
    return checkoutOperationError(request, error, {
      code: "tax_unavailable",
      title: "Order totals are unavailable",
      detail: "We could not calculate the final order total. Please try again.",
    })
  }
}
