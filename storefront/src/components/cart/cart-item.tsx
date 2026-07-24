"use client"

import type { HttpTypes } from "@medusajs/types"
import { Minus, Plus, Trash2 } from "lucide-react"
import Image from "next/image"
import { memo, useCallback, useMemo, useTransition } from "react"

import CartBundleDetails from "@/components/cart/cart-bundle-details"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import SmartLink from "@/components/ui/smart-link"
import { formatAmount } from "@/lib/money"
import {
  buildPublicProductPath,
  resolvePublicProductRouteType,
} from "@/lib/products/routes"
import { extractProductArtistNames } from "@/lib/products/slug"
import { cn } from "@/lib/ui/cn"
import { useCart } from "@/providers/cart-provider"

type CartLineItem = HttpTypes.StoreCartLineItem

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

  const quantity = item.variant?.inventory_quantity
  return typeof quantity === "number" && Number.isFinite(quantity)
    ? Math.max(0, Math.trunc(quantity))
    : null
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
    const [isPending, startTransition] = useTransition()

    const quantity = useMemo(() => Number(item.quantity ?? 1), [item.quantity])
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
    const totalAmount =
      typeof item.subtotal === "number"
        ? item.subtotal
        : Number(item.unit_price ?? 0) * quantity
    const atMaximum = typeof maxQuantity === "number" && quantity >= maxQuantity
    const lowStock =
      typeof maxQuantity === "number" && maxQuantity > 0 && maxQuantity <= 5
    const isFixedBundle = itemProductClass === "fixed_bundle"
    const isMysteryBundle = itemProductClass === "mystery_bundle"

    const changeQuantity = useCallback(
      (nextQuantity: number) => {
        startTransition(async () => {
          try {
            await updateItem(item.id, Math.max(0, nextQuantity))
          } catch {
            // The provider restores authoritative state and announces the error.
          }
        })
      },
      [item.id, updateItem]
    )
    const decreaseQuantity = useCallback(() => {
      changeQuantity(quantity - 1)
    }, [changeQuantity, quantity])
    const increaseQuantity = useCallback(() => {
      changeQuantity(quantity + 1)
    }, [changeQuantity, quantity])
    const remove = useCallback(() => {
      startTransition(async () => {
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
          isPending && "opacity-65",
          className
        )}
        aria-busy={isPending}
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
              <Badge variant="outline" className="px-2 py-0.5 text-[0.6rem]">
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
                disabled={isPending}
              >
                <Minus className="h-4 w-4" aria-hidden />
              </Button>
              <output
                className="min-w-8 text-center text-sm font-semibold tabular-nums"
                aria-live="polite"
              >
                {quantity}
              </output>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10 border-border/70 p-0"
                aria-label={`Increase quantity of ${title}`}
                onClick={increaseQuantity}
                disabled={isPending || atMaximum}
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
              disabled={isPending}
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
