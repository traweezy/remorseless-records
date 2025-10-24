"use client"

import { useMemo, useOptimistic, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ShoppingBag, X } from "lucide-react"

import type { HttpTypes } from "@medusajs/types"

import CartItem from "@/components/cart/cart-item"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Separator } from "@/components/ui/separator"
import { startStripeCheckout } from "@/lib/actions/start-stripe-checkout"
import { formatAmount } from "@/lib/money"

type CartDrawerProps = {
  cart: HttpTypes.StoreCart | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const currencyFromCart = (cart: HttpTypes.StoreCart | null): string =>
  cart?.currency_code ?? "usd"

const formatCartAmount = (cart: HttpTypes.StoreCart | null, amount: number | null | undefined) =>
  formatAmount(currencyFromCart(cart), Number(amount ?? 0))

/**
 * CartDrawer renders the cart experience as a right-aligned Sheet with optimistic updates.
 */
type OptimisticAction =
  | { type: "update"; id: string; quantity: number }
  | { type: "remove"; id: string }

export const CartDrawer = ({ cart, open, onOpenChange }: CartDrawerProps) => {
  const router = useRouter()
  const [isCheckoutPending, startCheckoutTransition] = useTransition()

  const [optimisticItems, applyOptimisticItems] = useOptimistic<
    HttpTypes.StoreCartLineItem[],
    OptimisticAction
  >(cart?.items ?? [], (state, action) => {
    switch (action.type) {
      case "update":
        return state.map((item) =>
          item.id === action.id ? { ...item, quantity: action.quantity } : item
        )
      case "remove":
        return state.filter((item) => item.id !== action.id)
      default:
        return state
    }
  })

  const currencyCode = currencyFromCart(cart)

  const itemCount = optimisticItems.reduce((total, item) => total + Number(item.quantity ?? 0), 0)

  const subtotal = useMemo(
    () => formatCartAmount(cart, cart?.subtotal),
    [cart]
  )
  const taxTotal = useMemo(() => formatCartAmount(cart, cart?.tax_total), [cart])
  const shippingTotal = useMemo(() => formatCartAmount(cart, cart?.shipping_total), [cart])
  const total = useMemo(() => formatCartAmount(cart, cart?.total), [cart])

  const hasItems = optimisticItems.length > 0

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-md">
        <SheetHeader className="flex flex-row items-center justify-between px-6 py-4">
          <div className="flex flex-col gap-1 text-left">
            <SheetTitle className="flex items-center gap-2 text-xl font-semibold text-foreground">
              <ShoppingBag className="h-5 w-5 text-accent" />
              Cart ({itemCount})
            </SheetTitle>
            <SheetDescription className="text-sm text-muted-foreground">
              Review your ritual stack before checkout.
            </SheetDescription>
          </div>
          <SheetClose asChild>
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/70 text-muted-foreground transition hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              aria-label="Close cart"
            >
              <X className="h-4 w-4" />
            </button>
          </SheetClose>
        </SheetHeader>

        {hasItems ? (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-6">
              <div className="space-y-6">
                {optimisticItems.map((item, index) => (
                  <CartItem
                    key={item.id ?? `${item.variant_id ?? "item"}-${index}`}
                    item={item}
                    currencyCode={currencyCode}
                    onQuantityOptimistic={(lineItemId, nextQuantity) =>
                      applyOptimisticItems({ type: "update", id: lineItemId, quantity: nextQuantity })
                    }
                    onRemoveOptimistic={(lineItemId) =>
                      applyOptimisticItems({ type: "remove", id: lineItemId })
                    }
                  />
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-4 border-t border-border/60 px-6 py-6">
              <dl className="space-y-3 text-sm text-muted-foreground">
                <div className="flex items-center justify-between">
                  <dt>Subtotal</dt>
                  <dd className="text-foreground">{subtotal}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt>Shipping</dt>
                  <dd className="text-foreground">{shippingTotal}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt>Tax</dt>
                  <dd className="text-foreground">{taxTotal}</dd>
                </div>
                <Separator className="border-border/60" />
                <div className="flex items-center justify-between text-base font-semibold text-foreground">
                  <dt>Total</dt>
                  <dd>{total}</dd>
                </div>
              </dl>

              <Button
                type="button"
                size="lg"
                className="h-12 w-full text-base font-semibold"
                disabled={!cart?.id || isCheckoutPending}
                onClick={() => {
                  if (!cart?.id) {
                    return
                  }

                  onOpenChange(false)
                  startCheckoutTransition(async () => {
                    await startStripeCheckout(cart.id)
                  })
                }}
              >
                {isCheckoutPending ? "Preparing checkout…" : "Proceed to Checkout"}
              </Button>

              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-12 w-full text-base font-semibold"
                onClick={() => {
                  onOpenChange(false)
                  router.push("/products")
                }}
              >
                Continue Shopping
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-border/60 text-muted-foreground">
              <ShoppingBag className="h-8 w-8" />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-foreground">Your cart is empty</h3>
              <p className="text-sm text-muted-foreground">
                Add some releases to unleash the full remorseless experience.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-12 w-full max-w-xs text-base font-semibold"
              onClick={() => {
                onOpenChange(false)
                router.push("/products")
              }}
            >
              Browse Catalog
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

export default CartDrawer
