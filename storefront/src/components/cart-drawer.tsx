"use client"

import type { HttpTypes } from "@medusajs/types"
import { ShoppingBag } from "lucide-react"
import { useRouter } from "next/navigation"
import { memo, useCallback, useTransition } from "react"
import { toast } from "sonner"

import CartItem from "@/components/cart/cart-item"
import { Button } from "@/components/ui/button"
import Drawer, {
  DrawerCloseButton,
  DrawerHeader,
  DrawerHeading,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { formatAmount } from "@/lib/money"
import { useCart } from "@/providers/cart-provider"
import type { StoreCart } from "@/providers/cart-provider"

const EMPTY_CART_ITEMS: HttpTypes.StoreCartLineItem[] = []

type CartDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const currencyFromCart = (cart: StoreCart): string =>
  cart?.currency_code ?? "usd"

const formattedAmount = (
  cart: StoreCart,
  amount: number | null | undefined
): string | null =>
  typeof amount === "number"
    ? formatAmount(currencyFromCart(cart), amount)
    : null

export const CartDrawer = memo<CartDrawerProps>(({ open, onOpenChange }) => {
  const router = useRouter()
  const [isCheckoutPending, startCheckoutTransition] = useTransition()
  const {
    addItem,
    cart,
    error,
    isLoading,
    isMutating,
    itemCount,
    refreshCart,
    removeItem,
  } = useCart()

  const items = cart?.items ?? EMPTY_CART_ITEMS
  const hasItems = items.length > 0
  const subtotal = formattedAmount(cart, cart?.subtotal)
  const hasShippingMethod = Boolean(cart?.shipping_methods?.length)
  const shipping = hasShippingMethod
    ? formattedAmount(cart, cart?.shipping_subtotal ?? cart?.shipping_total)
    : null
  const hasTaxAddress = Boolean(cart?.shipping_address?.country_code)
  const tax = hasTaxAddress ? formattedAmount(cart, cart?.tax_total) : null
  const discount =
    typeof cart?.discount_total === "number" && cart.discount_total > 0
      ? formattedAmount(cart, cart.discount_total)
      : null
  const currentTotal = formattedAmount(cart, cart?.total) ?? subtotal
  const totalsAreFinal = Boolean(shipping && tax)

  const handleRemove = useCallback(
    async (item: HttpTypes.StoreCartLineItem) => {
      await removeItem(item.id)

      const variantId = item.variant_id
      const quantity = Number(item.quantity ?? 1)
      const title = item.product_title ?? item.title
      toast(`${title} removed from cart.`, {
        ...(variantId
          ? {
              action: {
                label: "Undo",
                onClick: () => {
                  void addItem(variantId, quantity).catch(() => {
                    toast.error(
                      "This item could not be restored. Check its current availability."
                    )
                  })
                },
              },
            }
          : {}),
        duration: 5_000,
      })
    },
    [addItem, removeItem]
  )

  const goToCatalog = useCallback(() => {
    onOpenChange(false)
    router.push("/catalog")
  }, [onOpenChange, router])

  const goToCheckout = useCallback(() => {
    if (!cart?.id || isMutating) {
      return
    }
    onOpenChange(false)
    startCheckoutTransition(() => {
      router.push("/checkout")
    })
  }, [cart?.id, isMutating, onOpenChange, router])
  const retryCart = useCallback(() => {
    void refreshCart()
  }, [refreshCart])

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      ariaLabel="Shopping cart"
      maxWidthClassName="max-w-[32rem]"
      panelClassName="min-w-0"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <DrawerHeader className="px-4 py-4 sm:px-6">
          <DrawerHeading>
            <DrawerTitle className="flex items-center gap-2 text-2xl tracking-[0.24rem] sm:text-3xl">
              <ShoppingBag className="h-5 w-5 text-accent" aria-hidden />
              Cart
            </DrawerTitle>
            <p
              className="text-sm text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              {itemCount
                ? `${itemCount} item${itemCount === 1 ? "" : "s"}`
                : "No items yet"}
            </p>
          </DrawerHeading>
          <DrawerCloseButton label="Close cart" />
        </DrawerHeader>

        {isLoading && !cart ? (
          <div
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-4 py-6 sm:px-6"
            aria-label="Loading cart"
          >
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton
                key={`cart-drawer-loading-${index}`}
                className="h-32 w-full shrink-0 rounded-xl"
              />
            ))}
          </div>
        ) : hasItems ? (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
              <div className="space-y-4">
                {items.map((item, index) => (
                  <CartItem
                    key={item.id ?? `${item.variant_id ?? "item"}-${index}`}
                    item={item}
                    currencyCode={currencyFromCart(cart)}
                    onRemove={handleRemove}
                  />
                ))}
              </div>
            </div>

            <div className="shrink-0 space-y-4 border-t border-border/60 bg-background/98 px-4 py-5 sm:px-6">
              <dl className="space-y-2.5 text-sm text-muted-foreground">
                <div className="flex items-center justify-between gap-4">
                  <dt>Subtotal</dt>
                  <dd className="text-foreground">{subtotal ?? "—"}</dd>
                </div>
                {discount ? (
                  <div className="flex items-center justify-between gap-4 text-emerald-300">
                    <dt>Discount</dt>
                    <dd>−{discount}</dd>
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-4">
                  <dt>Shipping</dt>
                  <dd className="text-right text-foreground">
                    {shipping ?? "Calculated at checkout"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt>Tax</dt>
                  <dd className="text-right text-foreground">
                    {tax ?? "Calculated at checkout"}
                  </dd>
                </div>
                <Separator className="border-border/60" />
                <div className="flex items-center justify-between gap-4 text-base font-semibold text-foreground">
                  <dt>{totalsAreFinal ? "Total" : "Current total"}</dt>
                  <dd>{currentTotal ?? "—"}</dd>
                </div>
              </dl>

              {!totalsAreFinal ? (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Shipping and tax are confirmed after you enter your address.
                </p>
              ) : null}
              <p className="text-xs leading-relaxed text-muted-foreground">
                Availability is rechecked before purchase; cart items are not
                reserved.
              </p>

              {error ? (
                <div
                  className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                  role="alert"
                >
                  <p>{error}</p>
                  <Button
                    type="button"
                    variant="outlined"
                    size="compact"
                    onClick={retryCart}
                    disabled={isLoading}
                  >
                    Retry
                  </Button>
                </div>
              ) : null}

              <div className="grid gap-3">
                <Button
                  type="button"
                  size="lg"
                  className="h-12 w-full text-sm"
                  disabled={
                    !cart?.id || isLoading || isMutating || isCheckoutPending
                  }
                  onClick={goToCheckout}
                >
                  {isCheckoutPending ? "Opening checkout…" : "Checkout"}
                </Button>
                <Button
                  type="button"
                  variant="outlined"
                  size="lg"
                  className="h-12 w-full text-sm"
                  onClick={goToCatalog}
                >
                  Continue shopping
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 overflow-y-auto px-6 py-10 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-border/70 bg-background/80 shadow-glow">
              <ShoppingBag
                className="h-7 w-7 text-muted-foreground"
                aria-hidden
              />
            </div>
            <div className="max-w-sm space-y-2">
              <p className="text-lg font-semibold text-foreground">
                Your cart is empty
              </p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Browse the catalog and choose a format to get started.
              </p>
            </div>
            {error ? (
              <div
                className="max-w-sm rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                role="alert"
              >
                {error}
              </div>
            ) : null}
            <div className="flex w-full max-w-xs flex-col gap-3">
              {error ? (
                <Button
                  type="button"
                  variant="outlined"
                  onClick={retryCart}
                  disabled={isLoading}
                >
                  Retry cart
                </Button>
              ) : null}
              <Button type="button" size="lg" onClick={goToCatalog}>
                Browse catalog
              </Button>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  )
})
CartDrawer.displayName = "CartDrawer"

export default CartDrawer
