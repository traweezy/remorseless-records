"use client"

import CartItem from "@/components/cart/cart-item"
import { useCart } from "@/providers/cart-provider"

export const CartItemsList = () => {
  const { cart } = useCart()

  const items = cart?.items ?? []
  const currencyCode = cart?.currency_code ?? "usd"

  if (!items.length) {
    return null
  }

  return (
    <div className="space-y-6">
      {items.map((item, index) => (
        <CartItem
          key={item.id ?? `${item.variant_id ?? "item"}-${index}`}
          item={item}
          currencyCode={currencyCode}
        />
      ))}
    </div>
  )
}

export default CartItemsList
