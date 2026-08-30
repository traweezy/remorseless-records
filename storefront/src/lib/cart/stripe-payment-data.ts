import { taxQuoteIdentityFromCart } from "./tax-quote"
import {
  readBoundedText,
  readPositiveSafeInteger,
  readRecordArray,
} from "../provider-boundary"

type StripePaymentCart = {
  id: string
  items?: ReadonlyArray<{
    quantity?: number | null
    tax_lines?: ReadonlyArray<unknown> | null
  }> | null
  shipping_methods?: ReadonlyArray<unknown> | null
}

const STRIPE_PAYMENT_DESCRIPTION = "Remorseless Records order"

export const stripePaymentSessionData = (
  cart: StripePaymentCart
): Record<string, unknown> => {
  const cartId = readBoundedText(cart.id)
  const items = readRecordArray(cart.items, { optional: true })
  if (!cartId || !/^cart_[A-Za-z0-9]+$/.test(cartId) || !items) {
    throw new Error("Stripe payment metadata received a malformed cart.")
  }
  let itemCount = 0
  for (const item of items) {
    const quantity = readPositiveSafeInteger(item.quantity)
    if (quantity === null || !Number.isSafeInteger(itemCount + quantity)) {
      throw new Error("Stripe payment metadata received an invalid item count.")
    }
    itemCount += quantity
  }
  const taxQuote = taxQuoteIdentityFromCart(cart)
  return {
    payment_description: STRIPE_PAYMENT_DESCRIPTION,
    metadata: {
      ...(taxQuote.calculationId
        ? { rr_tax_calculation_id: taxQuote.calculationId }
        : {}),
      rr_tax_fingerprint: taxQuote.fingerprint,
      rr_tax_generation: String(taxQuote.generation),
      rr_tax_collection_mode: taxQuote.collectionMode,
      ...(taxQuote.provider ? { rr_tax_provider: taxQuote.provider } : {}),
      ...(taxQuote.taxRatePercent !== null
        ? { rr_tax_rate_percent: String(taxQuote.taxRatePercent) }
        : {}),
      commerce_platform: "medusa",
      item_count: String(itemCount),
      medusa_cart_id: cartId,
      storefront: "remorseless-records",
    },
  }
}
