import type { HttpTypes } from "@medusajs/types"
import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"

import { resolveActiveCheckoutCart } from "@/features/checkout/server/active-cart"
import { checkoutOperationError } from "@/features/checkout/server/errors"
import { guardCheckoutRead } from "@/features/checkout/server/guards"
import type { CheckoutShippingOption } from "@/features/checkout/types/checkout"
import { listShippingOptions } from "@/lib/cart/api"
import { jsonApiResponse } from "@/lib/security/route-guards"

const toCheckoutOption = (
  option: HttpTypes.StoreCartShippingOptionWithServiceZone
): CheckoutShippingOption => ({
  id: option.id,
  name: option.name,
  description: option.type?.description?.trim() || null,
  amount: option.amount,
  currencyCode: "usd",
  insufficientInventory: option.insufficient_inventory,
})

export const GET = async (request: NextRequest): Promise<Response> => {
  noStore()
  const rateLimited = await guardCheckoutRead(request, {
    key: "shipping-options",
    max: 120,
  })
  if (rateLimited) {
    return rateLimited
  }

  const active = await resolveActiveCheckoutCart(request)
  if (!active.ok) {
    return active.response
  }

  try {
    const response = await listShippingOptions(active.value.cart.id)
    return jsonApiResponse({
      shippingOptions: (response.shipping_options ?? []).map(toCheckoutOption),
    })
  } catch (error: unknown) {
    return checkoutOperationError(request, error, {
      code: "shipping_unavailable",
      title: "Delivery methods are unavailable",
      detail: "We could not load delivery methods. Please try again.",
    })
  }
}
