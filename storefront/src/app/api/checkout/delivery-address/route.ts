import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"

import {
  checkoutDeliverySchema,
  type CheckoutAddressInput,
} from "@/features/checkout/schemas/checkout"
import {
  checkoutProjectionResponse,
  resolveActiveCheckoutCart,
} from "@/features/checkout/server/active-cart"
import { checkoutOperationError } from "@/features/checkout/server/errors"
import { guardCheckoutMutation } from "@/features/checkout/server/guards"
import { setCartAddresses } from "@/lib/cart/api"
import type { StoreCartAddressInput } from "@/lib/cart/types"
import { parseJsonBody } from "@/lib/security/route-guards"

const toStoreAddress = (
  address: CheckoutAddressInput
): StoreCartAddressInput => ({
  first_name: address.first_name,
  last_name: address.last_name,
  address_1: address.address_1,
  city: address.city,
  province: address.province,
  postal_code: address.postal_code,
  country_code: address.country_code,
  ...(address.address_2 ? { address_2: address.address_2 } : {}),
  ...(address.phone ? { phone: address.phone } : {}),
})

export const PUT = async (request: NextRequest): Promise<Response> => {
  noStore()
  const guarded = await guardCheckoutMutation(request, {
    key: "delivery-address",
    max: 30,
  })
  if (guarded) {
    return guarded
  }

  const parsed = await parseJsonBody(request, checkoutDeliverySchema, {
    maxBytes: 12 * 1024,
  })
  if (!parsed.ok) {
    return parsed.response
  }

  const active = await resolveActiveCheckoutCart(request)
  if (!active.ok) {
    return active.response
  }

  const shippingAddress = toStoreAddress(parsed.data.shipping_address)
  const billingAddress = parsed.data.billing_address
    ? toStoreAddress(parsed.data.billing_address)
    : shippingAddress

  try {
    const cart = await setCartAddresses(
      active.value.cart.id,
      {
        shipping_address: shippingAddress,
        billing_address: billingAddress,
      },
      request
    )
    return checkoutProjectionResponse({
      cart,
      needsCookieRotation: active.value.needsCookieRotation,
    })
  } catch (error: unknown) {
    return checkoutOperationError(request, error, {
      code: "address_invalid",
      title: "Delivery address was not saved",
      detail: "Check the delivery address and try again.",
    })
  }
}
