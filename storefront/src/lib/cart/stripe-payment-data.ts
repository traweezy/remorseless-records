import { taxQuoteIdentityFromCart } from "./tax-quote"

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
      item_count: String(
        (cart.items ?? []).reduce(
          (total, item) => total + Number(item.quantity ?? 0),
          0
        )
      ),
      medusa_cart_id: cart.id,
      storefront: "remorseless-records",
    },
  }
}
