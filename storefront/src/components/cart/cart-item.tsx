"use client"

import type { HttpTypes } from "@medusajs/types"
import { Minus, Plus, Trash2 } from "lucide-react"
import Image from "next/image"
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react"

import CartBundleDetails from "@/components/cart/cart-bundle-details"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import SmartLink from "@/components/ui/smart-link"
import { cartAmount, cartQuantity } from "@/lib/cart/snapshot"
import { formatAmount } from "@/lib/money"
import { readNonNegativeSafeInteger } from "@/lib/provider-boundary"
import {
  buildPublicProductPath,
  resolvePublicProductRouteType,
} from "@/lib/products/routes"
import { extractProductArtistNames } from "@/lib/products/slug"
import { cn } from "@/lib/ui/cn"
import { useCart } from "@/providers/cart-provider"

type CartLineItem = HttpTypes.StoreCartLineItem
const MAX_CART_QUANTITY = 100

type CartItemProps = {
  item: CartLineItem
  currencyCode: string
  className?: string
  onRemove?: (item: CartLineItem) => Promise<void>
}

const readableVariantTitle = (item: CartLineItem): string | null => {
  const title = item.variant_title ?? item.variant?.title
  if (!title || /^default( variant)?$/i.test(title.trim())) {
    return null
  }
  return title
}

const availableQuantity = (item: CartLineItem): number | null => {
  if (
    item.variant?.allow_backorder ||
    item.variant?.manage_inventory === false
  ) {
    return null
  }

  return readNonNegativeSafeInteger(item.variant?.inventory_quantity)
}

const productClass = (item: CartLineItem): string | null => {
  const metadata = item.product?.metadata
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null
  }
  const catalogImport = metadata.catalog_import
  if (
    !catalogImport ||
    typeof catalogImport !== "object" ||
    Array.isArray(catalogImport)
  ) {
    return null
  }
  const importedProductType = (catalogImport as Record<string, unknown>)
    .product_type
  return typeof importedProductType === "string" ? importedProductType : null
}

export const CartItem = memo<CartItemProps>(
  ({ item, currencyCode, className, onRemove }) => {
    const { updateItem, removeItem } = useCart()
    const [isRemovePending, startRemoveTransition] = useTransition()
    const [isQuantityUpdating, setIsQuantityUpdating] = useState(false)

    const quantity = useMemo(
      () => cartQuantity(item.quantity) ?? 1,
      [item.quantity]
    )
    const [displayQuantity, setDisplayQuantity] = useState(quantity)
    const authoritativeQuantityRef = useRef(quantity)
    const desiredQuantityRef = useRef(quantity)
    const isFlushingQuantityRef = useRef(false)
    const maxQuantity = useMemo(() => availableQuantity(item), [item])
    const title = item.product_title ?? item.title
    const variantTitle = readableVariantTitle(item)
    const itemProductClass = productClass(item)
    const productRouteType = resolvePublicProductRouteType({
      handle: item.product_handle,
      productType: itemProductClass,
    })
    const artistDisplay = useMemo(
      () =>
        productRouteType === "music-release" || productRouteType === "bundle"
          ? extractProductArtistNames({
              title,
              ...(item.product_handle ? { handle: item.product_handle } : {}),
              ...(item.product?.metadata
                ? { metadata: item.product.metadata }
                : {}),
            }).join(" / ")
          : "",
      [item.product?.metadata, item.product_handle, productRouteType, title]
    )
    const productHref = item.product_handle
      ? buildPublicProductPath({ handle: item.product_handle })
      : null
    const subtotal = cartAmount(item.subtotal)
    const unitPrice = cartAmount(item.unit_price) ?? 0
    const totalAmount =
      !isQuantityUpdating && subtotal !== null
        ? subtotal
        : unitPrice * displayQuantity
    const maximumAllowedQuantity =
      typeof maxQuantity === "number"
        ? Math.min(maxQuantity, MAX_CART_QUANTITY)
        : MAX_CART_QUANTITY
    const atMaximum = displayQuantity >= maximumAllowedQuantity
    const lowStock =
      typeof maxQuantity === "number" && maxQuantity > 0 && maxQuantity <= 5
    const isFixedBundle = itemProductClass === "fixed_bundle"
    const isMysteryBundle = itemProductClass === "mystery_bundle"
    const isBusy = isQuantityUpdating || isRemovePending

    useEffect(() => {
      authoritativeQuantityRef.current = quantity
      if (!isFlushingQuantityRef.current) {
        desiredQuantityRef.current = quantity
        setDisplayQuantity(quantity)
      }
    }, [quantity])

    const flushQuantityChanges = useCallback(async () => {
      if (isFlushingQuantityRef.current) {
        return
      }

      isFlushingQuantityRef.current = true
      setIsQuantityUpdating(true)
      try {
        for (;;) {
          const targetQuantity = desiredQuantityRef.current
          await updateItem(item.id, targetQuantity)
          authoritativeQuantityRef.current = targetQuantity
          if (desiredQuantityRef.current === targetQuantity) {
            break
          }
        }
      } catch {
        const restoredQuantity = authoritativeQuantityRef.current
        desiredQuantityRef.current = restoredQuantity
        setDisplayQuantity(restoredQuantity)
        // The provider restores authoritative state and announces the error.
      } finally {
        isFlushingQuantityRef.current = false
        setIsQuantityUpdating(false)
      }
    }, [item.id, updateItem])

    const changeQuantityBy = useCallback(
      (delta: number) => {
        const nextQuantity = Math.min(
          maximumAllowedQuantity,
          Math.max(0, desiredQuantityRef.current + delta)
        )
        if (nextQuantity === desiredQuantityRef.current) {
          return
        }

        desiredQuantityRef.current = nextQuantity
        setDisplayQuantity(nextQuantity)
        void flushQuantityChanges()
      },
      [flushQuantityChanges, maximumAllowedQuantity]
    )
    const decreaseQuantity = useCallback(() => {
      changeQuantityBy(-1)
    }, [changeQuantityBy])
    const increaseQuantity = useCallback(() => {
      changeQuantityBy(1)
    }, [changeQuantityBy])
    const remove = useCallback(() => {
      startRemoveTransition(async () => {
        try {
          if (onRemove) {
            await onRemove(item)
          } else {
            await removeItem(item.id)
          }
        } catch {
          // The provider restores authoritative state and announces the error.
        }
      })
    }, [item, onRemove, removeItem])

    const image = (
      <span className="relative block h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-muted">
        {item.thumbnail ? (
          <Image
            src={item.thumbnail}
            alt=""
            fill
            className="object-cover"
            sizes="80px"
            loading="lazy"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center px-2 text-center text-xs font-medium text-muted-foreground">
            No image
          </span>
        )}
      </span>
    )

    return (
      <article
        className={cn(
          "grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] gap-3 rounded-xl border border-border/60 bg-background/90 p-3 shadow-card transition-opacity sm:gap-4 sm:p-4",
          isRemovePending && "opacity-65",
          className
        )}
        aria-busy={isBusy}
      >
        {productHref ? (
          <SmartLink
            href={productHref}
            nativePrefetch
            aria-label={`View ${title}`}
            className="self-start rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {image}
          </SmartLink>
        ) : (
          image
        )}

        <div className="flex min-w-0 flex-col gap-3">
          <div className="min-w-0 space-y-1">
            <h3 className="break-words text-sm font-semibold leading-snug text-foreground sm:text-base">
              {productHref ? (
                <SmartLink
                  href={productHref}
                  nativePrefetch
                  className="inline-flex min-h-6 items-center rounded-sm hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  {title}
                </SmartLink>
              ) : (
                title
              )}
            </h3>
            {artistDisplay ? (
              <p className="break-words text-xs font-medium text-muted-foreground">
                {artistDisplay}
              </p>
            ) : null}
            {variantTitle ? (
              <p className="break-words text-xs uppercase tracking-[0.16rem] text-muted-foreground">
                {variantTitle}
              </p>
            ) : null}
            {isFixedBundle || isMysteryBundle ? (
              <Badge variant="outline" className="px-2 py-0.5 text-[0.7rem]">
                {isMysteryBundle ? "Mystery bundle" : "Bundle"}
              </Badge>
            ) : null}
            {lowStock ? (
              <p className="text-xs font-medium text-amber-200" role="status">
                Only {maxQuantity} available
              </p>
            ) : null}
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div
              className="flex items-center gap-1.5"
              role="group"
              aria-label={`Quantity for ${title}`}
            >
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10 border-border/70 p-0"
                aria-label={
                  quantity === 1
                    ? `Decrease quantity of ${title} (removes item)`
                    : `Decrease quantity of ${title}`
                }
                onClick={decreaseQuantity}
                disabled={isRemovePending || displayQuantity <= 0}
              >
                <Minus className="h-4 w-4" aria-hidden />
              </Button>
              <output
                className="min-w-8 text-center text-sm font-semibold tabular-nums"
                aria-live="polite"
              >
                {displayQuantity}
              </output>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10 border-border/70 p-0"
                aria-label={`Increase quantity of ${title}`}
                onClick={increaseQuantity}
                disabled={isRemovePending || atMaximum}
              >
                <Plus className="h-4 w-4" aria-hidden />
              </Button>
            </div>

            <span className="ml-auto whitespace-nowrap text-sm font-semibold text-accent sm:text-base">
              {formatAmount(currencyCode, totalAmount)}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-10 w-10 border-border/70 p-0 text-muted-foreground hover:border-destructive hover:text-destructive"
              aria-label={`Remove ${title}`}
              onClick={remove}
              disabled={isBusy}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>
          {isFixedBundle && item.product_handle ? (
            <CartBundleDetails
              handle={item.product_handle}
              selectedVariantId={item.variant_id ?? null}
            />
          ) : null}
          {isMysteryBundle ? (
            <p className="border-t border-border/50 pt-3 text-xs leading-relaxed text-muted-foreground">
              Three formats are selected when your order is packed.
            </p>
          ) : null}
        </div>
      </article>
    )
  }
)
CartItem.displayName = "CartItem"

export default CartItem
