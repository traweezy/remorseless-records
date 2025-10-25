"use client"

import type { HttpTypes } from "@medusajs/types"
import Image from "next/image"
import { Minus, Plus, Trash2 } from "lucide-react"
import { useMemo } from "react"

import { formatAmount } from "@/lib/money"
import { cn } from "@/lib/ui/cn"
import {
  useRemoveCartItemMutation,
  useUpdateCartItemQuantityMutation,
} from "@/lib/mutations/cart"

type CartLineItem = HttpTypes.StoreCartLineItem

type CartItemProps = {
  item: CartLineItem
  currencyCode: string
  className?: string
}

/**
 * CartItem renders an individual cart line with image, metadata and quantity controls.
 * It performs optimistic UI updates while server actions persist changes.
 */
export const CartItem = ({
  item,
  currencyCode,
  className,
}: CartItemProps) => {
  const updateMutation = useUpdateCartItemQuantityMutation()
  const removeMutation = useRemoveCartItemMutation()

  const quantity = useMemo(() => Number(item.quantity ?? 1), [item.quantity])
  const totalAmount = useMemo(
    () => Number(item.total ?? item.subtotal ?? 0),
    [item.total, item.subtotal]
  )

  const handleQuantityChange = (nextQuantity: number) => {
    const normalized = Math.max(1, nextQuantity)

    updateMutation.mutate({
      lineItemId: item.id,
      quantity: normalized,
    })
  }

  const handleRemove = () => {
    removeMutation.mutate({ lineItemId: item.id })
  }

  const isPending = updateMutation.isPending || removeMutation.isPending

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
