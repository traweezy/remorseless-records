import "server-only"

import type { HttpTypes } from "@medusajs/types"

import {
  addShippingMethod,
  calculateTaxes,
  listShippingOptions,
} from "@/lib/cart/api"

export class CheckoutRevalidationError extends Error {
  readonly code = "shipping_changed"

  constructor(message: string) {
    super(message)
    this.name = "CheckoutRevalidationError"
  }
}

export const revalidateShippingAndTaxes = async (
  cart: HttpTypes.StoreCart,
  request?: Request
): Promise<HttpTypes.StoreCart> => {
  const selectedOptionId = cart.shipping_methods?.[0]?.shipping_option_id
  if (!selectedOptionId) {
    throw new CheckoutRevalidationError(
      "Choose an available delivery method before payment."
    )
  }

  const available = await listShippingOptions(cart.id, request)
  const selected = available.shipping_options?.find(
    (option) => option.id === selectedOptionId && !option.insufficient_inventory
  )
  if (!selected) {
    throw new CheckoutRevalidationError(
      "The selected delivery method is no longer available."
    )
  }

  await addShippingMethod(cart.id, selected.id, request)
  return calculateTaxes(cart.id, request)
}
