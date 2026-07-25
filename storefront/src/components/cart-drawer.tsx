"use client"

import type { HttpTypes } from "@medusajs/types"
import { ShoppingBag } from "lucide-react"
import { useRouter } from "next/navigation"
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react"

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
const UNDO_DURATION_MS = 8_000

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
  const [isUndoPending, setIsUndoPending] = useState(false)
  const [recentlyRemoved, setRecentlyRemoved] =
    useState<HttpTypes.StoreCartLineItem | null>(null)
  const [undoError, setUndoError] = useState<string | null>(null)
  const undoExpirationRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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

  const clearUndoExpiration = useCallback(() => {
    if (undoExpirationRef.current) {
      clearTimeout(undoExpirationRef.current)
      undoExpirationRef.current = null
    }
  }, [])

  useEffect(() => clearUndoExpiration, [clearUndoExpiration])

  const handleRemove = useCallback(
    async (item: HttpTypes.StoreCartLineItem) => {
      await removeItem(item.id)

      clearUndoExpiration()
      setUndoError(null)
      setRecentlyRemoved(item.variant_id ? item : null)
      if (item.variant_id) {
        undoExpirationRef.current = setTimeout(() => {
          setRecentlyRemoved(null)
          undoExpirationRef.current = null
        }, UNDO_DURATION_MS)
      }
    },
    [clearUndoExpiration, removeItem]
  )

  const handleUndo = useCallback(async () => {
    const item = recentlyRemoved
    if (!item?.variant_id || isUndoPending) {
      return
    }

    clearUndoExpiration()
    setIsUndoPending(true)
    setUndoError(null)
    try {
      await addItem(item.variant_id, Number(item.quantity ?? 1))
      setRecentlyRemoved(null)
    } catch {
      setUndoError(
        "This item could not be restored. Check its current availability and try again."
      )
    } finally {
      setIsUndoPending(false)
    }
  }, [addItem, clearUndoExpiration, isUndoPending, recentlyRemoved])
  const requestUndo = useCallback(() => {
    void handleUndo()
  }, [handleUndo])

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
  const removedTitle =
    recentlyRemoved?.product_title ?? recentlyRemoved?.title ?? "Item"
  const undoNotice = recentlyRemoved ? (
    <div
      className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card px-4 py-3 text-left shadow-[0_16px_38px_-28px_rgba(0,0,0,0.85)]"
      role="status"
      aria-live="polite"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">
          {removedTitle} removed
        </p>
        {undoError ? (
          <p
            className="mt-1 text-xs leading-relaxed text-destructive"
            role="alert"
          >
            {undoError}
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            Restore it before this notice expires.
          </p>
        )}
      </div>
      <Button
        type="button"
        variant="outlined"
        size="compact"
        onClick={requestUndo}
        disabled={isUndoPending}
      >
        {isUndoPending ? "Restoring…" : "Undo"}
      </Button>
    </div>
  ) : null

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
                {undoNotice}
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
            {undoNotice}
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-destructive/35 bg-destructive/10">
              <ShoppingBag className="h-7 w-7 text-destructive" aria-hidden />
            </div>
            <div className="max-w-sm">
              <p className="text-lg font-semibold text-foreground">
                Your cart is empty
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
