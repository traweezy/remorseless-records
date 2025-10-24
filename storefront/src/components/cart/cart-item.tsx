"use client"

import { useTransition } from "react"
import Image from "next/image"
import { Minus, Plus, Trash2 } from "lucide-react"

import type { HttpTypes } from "@medusajs/types"

import { removeCartItem } from "@/lib/actions/remove-cart-item"
import { updateCartItemQuantity } from "@/lib/actions/update-cart-item"
import { formatAmount } from "@/lib/money"
import { cn } from "@/lib/ui/cn"

type CartLineItem = HttpTypes.StoreCartLineItem

type CartItemProps = {
  item: CartLineItem
  currencyCode: string
  className?: string
  onRemoveOptimistic?: (lineItemId: string) => void
  onQuantityOptimistic?: (lineItemId: string, nextQuantity: number) => void
}

/**
 * CartItem renders an individual cart line with image, metadata and quantity controls.
 * It performs optimistic UI updates while server actions persist changes.
 */
export const CartItem = ({
  item,
  currencyCode,
  className,
  onRemoveOptimistic,
  onQuantityOptimistic,
}: CartItemProps) => {
  const [isPending, startTransition] = useTransition()

  const quantity = Number(item.quantity ?? 1)
  const totalAmount = Number(item.total ?? item.subtotal ?? 0)

  const handleQuantityChange = (nextQuantity: number) => {
    const normalized = Math.max(1, nextQuantity)

    onQuantityOptimistic?.(item.id, normalized)

    startTransition(async () => {
      try {
        await updateCartItemQuantity(item.id, normalized, { redirectPath: "/cart" })
      } catch (error) {
        console.error(error)
      }
    })
  }

  const handleRemove = () => {
    onRemoveOptimistic?.(item.id)

    startTransition(async () => {
      try {
        await removeCartItem(item.id, { redirectPath: "/cart" })
      } catch (error) {
        console.error(error)
      }
    })
  }

  return (
    <article
      className={cn(
        "flex gap-4 rounded-xl border border-border/60 bg-background/90 p-4 shadow-card transition duration-150 ease-out",
        isPending && "opacity-75",
        className
      )}
      aria-busy={isPending}
    >
      <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-muted">
        {item.thumbnail ? (
          <Image
            src={item.thumbnail}
            alt={item.title ?? "Cart item artwork"}
            fill
            className="object-cover"
            sizes="80px"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm font-medium text-muted-foreground">
            No image
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-foreground leading-tight">
            {item.title}
          </h3>
          <p className="text-sm text-muted-foreground">
            {item.variant?.title ?? "Standard edition"}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Decrease quantity"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border/70 text-foreground transition hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              onClick={() => handleQuantityChange(quantity - 1)}
              disabled={isPending}
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="min-w-[2.25rem] text-center text-base font-medium">
              {quantity}
            </span>
            <button
              type="button"
              aria-label="Increase quantity"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border/70 text-foreground transition hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              onClick={() => handleQuantityChange(quantity + 1)}
              disabled={isPending}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-base font-semibold text-accent">
              {formatAmount(currencyCode, totalAmount)}
            </span>
            <button
              type="button"
              aria-label="Remove item"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border/70 text-muted-foreground transition hover:border-destructive hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              onClick={handleRemove}
              disabled={isPending}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}

export default CartItem
