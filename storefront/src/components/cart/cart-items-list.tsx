"use client"

import { useOptimistic } from "react"

import type { HttpTypes } from "@medusajs/types"

import CartItem from "@/components/cart/cart-item"

type CartItemsListProps = {
  cart: HttpTypes.StoreCart
}

/**
 * CartItemsList renders the cart items within the cart page, reusing the same optimistic updates
 * as the drawer while omitting totals/controls that live elsewhere on the page.
 */
type OptimisticAction =
  | { type: "update"; id: string; quantity: number }
  | { type: "remove"; id: string }

export const CartItemsList = ({ cart }: CartItemsListProps) => {
  const [items, applyOptimisticUpdate] = useOptimistic<
    HttpTypes.StoreCartLineItem[],
    OptimisticAction
  >(cart.items ?? [], (state, action) => {
    switch (action.type) {
      case "update":
        return state.map((lineItem) =>
          lineItem.id === action.id ? { ...lineItem, quantity: action.quantity } : lineItem
        )
      case "remove":
        return state.filter((lineItem) => lineItem.id !== action.id)
      default:
        return state
    }
  })

  const currencyCode = cart.currency_code ?? "usd"

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
          onQuantityOptimistic={(lineItemId, nextQuantity) =>
            applyOptimisticUpdate({ type: "update", id: lineItemId, quantity: nextQuantity })
          }
          onRemoveOptimistic={(lineItemId) =>
            applyOptimisticUpdate({ type: "remove", id: lineItemId })
          }
        />
      ))}
    </div>
  )
}

export default CartItemsList
