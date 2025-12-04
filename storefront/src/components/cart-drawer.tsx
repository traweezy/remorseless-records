"use client"

import { motion, useReducedMotion, type Transition, type Variants } from "framer-motion"
import { ShoppingBag, X } from "lucide-react"
import { useMemo, useTransition } from "react"
import { useRouter } from "next/navigation"
import type { HttpTypes } from "@medusajs/types"

import CartItem from "@/components/cart/cart-item"
import { Button } from "@/components/ui/button"
import Drawer from "@/components/ui/drawer"
import { Separator } from "@/components/ui/separator"
import { startStripeCheckout } from "@/lib/actions/start-stripe-checkout"
import type { StoreCart } from "@/lib/query/cart"
import { useCartQuery } from "@/lib/query/cart"
import { formatAmount } from "@/lib/money"

const MotionButton = motion(Button)

const EMPTY_CART_ITEMS: HttpTypes.StoreCartLineItem[] = []

type CartDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const currencyFromCart = (cart: StoreCart): string =>
  cart?.currency_code ?? "usd"

const formatCartAmount = (cart: StoreCart, amount: number | null | undefined) =>
  formatAmount(currencyFromCart(cart), Number(amount ?? 0))

export const CartDrawer = ({ open, onOpenChange }: CartDrawerProps) => {
  const router = useRouter()
  const [isCheckoutPending, startCheckoutTransition] = useTransition()
  const prefersReducedMotion = useReducedMotion()
  const { data: cart } = useCartQuery()
  const hydratedCart: StoreCart = cart ?? null

  const items = hydratedCart?.items ?? EMPTY_CART_ITEMS
  const hasItems = items.length > 0
  const itemCount = useMemo(
    () => items.reduce((total, item) => total + Number(item.quantity ?? 0), 0),
    [items]
  )

  const subtotal = useMemo(() => formatCartAmount(hydratedCart, hydratedCart?.subtotal), [hydratedCart])
  const taxTotal = useMemo(() => formatCartAmount(hydratedCart, hydratedCart?.tax_total), [hydratedCart])
  const shippingTotal = useMemo(
    () => formatCartAmount(hydratedCart, hydratedCart?.shipping_total),
    [hydratedCart]
  )
  const total = useMemo(() => formatCartAmount(hydratedCart, hydratedCart?.total), [hydratedCart])

  const easeOutExpo = [0.4, 0, 0.2, 1] as const

  const listVariants: Variants = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: prefersReducedMotion ? 0 : 0.05,
        delayChildren: prefersReducedMotion ? 0 : 0.1,
      },
    },
  }

  const itemVariants: Variants = {
    hidden: {
      opacity: prefersReducedMotion ? 1 : 0,
      x: prefersReducedMotion ? 0 : 20,
    },
    visible: {
      opacity: 1,
      x: 0,
      transition: { duration: 0.3, ease: easeOutExpo },
    },
  }

  const checkoutTransition: Transition = prefersReducedMotion
    ? { duration: 0.15, ease: easeOutExpo }
    : { type: "spring", stiffness: 400, damping: 17 }

  const secondaryTransition: Transition = prefersReducedMotion
    ? { duration: 0.12, ease: easeOutExpo }
    : { type: "spring", stiffness: 320, damping: 20 }

  const emptyStateTransition: Transition = prefersReducedMotion
    ? { duration: 0.15, ease: easeOutExpo }
    : { type: "spring", stiffness: 360, damping: 18 }

  const checkoutInteractions = prefersReducedMotion
    ? {}
    : {
        whileHover: { scale: 1.02 },
        whileTap: { scale: 0.98 },
      }

  const secondaryInteractions = prefersReducedMotion
    ? {}
    : {
        whileHover: { scale: 1.01 },
        whileTap: { scale: 0.99 },
      }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} ariaLabel="Cart">
      <div className="flex flex-1 flex-col p-0">
        <header className="flex items-start justify-between border-b border-border/60 px-6 py-4">
          <div className="space-y-1 text-left">
            <p className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <ShoppingBag className="h-5 w-5 text-accent" />
              Cart ({itemCount})
            </p>
            <p className="text-sm text-muted-foreground">
              Review your ritual stack before checkout.
            </p>
          </div>
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/70 text-muted-foreground transition hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label="Close cart"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {hasItems ? (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-6">
              <motion.div
                key="cart-items"
                initial="hidden"
                animate="visible"
                variants={listVariants}
                className="space-y-6"
              >
                {items.map((item, index) => (
                  <motion.div
                    key={item.id ?? `${item.variant_id ?? "item"}-${index}`}
                    variants={itemVariants}
                    layout
                  >
                    <CartItem item={item} currencyCode={currencyFromCart(hydratedCart)} />
                  </motion.div>
                ))}
              </motion.div>
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

              <MotionButton
                type="button"
                size="lg"
                className="h-12 w-full text-base font-semibold"
                disabled={!hydratedCart?.id || isCheckoutPending}
                {...checkoutInteractions}
                transition={checkoutTransition}
                onClick={() => {
                  const cartId = hydratedCart?.id
                  if (!cartId) {
                    return
                  }

                  onOpenChange(false)
                  startCheckoutTransition(async () => {
                    await startStripeCheckout(cartId)
                  })
                }}
              >
                Checkout
              </MotionButton>

              <MotionButton
                type="button"
                variant="outline"
                size="lg"
                className="h-12 w-full text-base"
                disabled={!hasItems}
                {...secondaryInteractions}
                transition={secondaryTransition}
                onClick={() => {
                  onOpenChange(false)
                  router.push("/cart")
                }}
              >
                View full cart
              </MotionButton>
            </div>
          </>
        ) : (
          <motion.div
            key="empty-cart"
            className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center"
            initial={{ opacity: prefersReducedMotion ? 1 : 0, y: prefersReducedMotion ? 0 : 6 }}
            animate={{ opacity: 1, y: 0, transition: emptyStateTransition }}
            exit={{ opacity: 0, y: prefersReducedMotion ? 0 : 6, transition: emptyStateTransition }}
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-border/70 bg-background/80 shadow-glow">
              <ShoppingBag className="h-7 w-7 text-muted-foreground" />
            </div>
            <div className="space-y-2">
              <p className="text-lg font-semibold text-foreground">
                Your cart is empty
              </p>
              <p className="text-sm text-muted-foreground">
                Summon something brutal to begin your ritual.
              </p>
            </div>
            <MotionButton
              type="button"
              size="lg"
              className="mt-2"
              {...secondaryInteractions}
              transition={secondaryTransition}
              onClick={() => {
                onOpenChange(false)
                router.push("/products")
              }}
            >
              Browse catalog
            </MotionButton>
          </motion.div>
        )}
      </div>
    </Drawer>
  )
}

export default CartDrawer
