import { HydrationBoundary } from "@tanstack/react-query"

import CartPageClient from "@/components/cart/cart-page-client"
import { getCart } from "@/lib/cart"
import { createDehydratedCartState } from "@/lib/query/cart"

const CartPage = async () => {
  const cart = await getCart()
  const dehydratedState = createDehydratedCartState(cart ?? null)

  return (
    <HydrationBoundary state={dehydratedState}>
      <CartPageClient />
    </HydrationBoundary>
  )
}

export default CartPage
