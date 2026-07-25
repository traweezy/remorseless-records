type StripePaymentCart = {
  id: string
  items?: ReadonlyArray<{ quantity?: number | null }> | null
}

const STRIPE_PAYMENT_DESCRIPTION = "Remorseless Records order"

export const stripePaymentSessionData = (
  cart: StripePaymentCart
): Record<string, unknown> => ({
  payment_description: STRIPE_PAYMENT_DESCRIPTION,
  metadata: {
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
})
