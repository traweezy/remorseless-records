"use client"

import { ChevronDown, Lock, Minus, Plus, Trash2 } from "lucide-react"
import Image from "next/image"
import { memo, useCallback, useEffect, useId, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import type {
  CheckoutItem,
  CheckoutProjection,
} from "@/features/checkout/types/checkout"
import { formatAmount } from "@/lib/money"
import { cn } from "@/lib/ui/cn"

type CheckoutSummaryProps = {
  checkout: CheckoutProjection
  onRemoveItem?: (itemId: string) => Promise<void>
  onUpdateItem?: (itemId: string, quantity: number) => Promise<void>
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  className?: string
}

type CheckoutSummaryItemProps = {
  currencyCode: string
  item: CheckoutItem
  onRemove: ((itemId: string) => Promise<void>) | undefined
  onUpdate: ((itemId: string, quantity: number) => Promise<void>) | undefined
}

const MAX_CART_QUANTITY = 100

const CheckoutSummaryItem = memo<CheckoutSummaryItemProps>(
  ({ currencyCode, item, onRemove, onUpdate }) => {
    const [displayQuantity, setDisplayQuantity] = useState(item.quantity)
    const [isRemoving, setIsRemoving] = useState(false)
    const [isUpdating, setIsUpdating] = useState(false)
    const authoritativeQuantityRef = useRef(item.quantity)
    const desiredQuantityRef = useRef(item.quantity)
    const isFlushingRef = useRef(false)
    const maximumQuantity =
      typeof item.availableQuantity === "number"
        ? Math.min(
            Math.max(item.quantity, item.availableQuantity),
            MAX_CART_QUANTITY
          )
        : MAX_CART_QUANTITY

    useEffect(() => {
      authoritativeQuantityRef.current = item.quantity
      if (!isFlushingRef.current) {
        desiredQuantityRef.current = item.quantity
        setDisplayQuantity(item.quantity)
      }
    }, [item.quantity])

    const flush = useCallback(async (): Promise<void> => {
      if (!onUpdate || isFlushingRef.current) {
        return
      }

      isFlushingRef.current = true
      setIsUpdating(true)
      try {
        for (;;) {
          const target = desiredQuantityRef.current
          await onUpdate(item.id, target)
          authoritativeQuantityRef.current = target
          if (desiredQuantityRef.current === target) {
            break
          }
        }
      } catch {
        const restored = authoritativeQuantityRef.current
        desiredQuantityRef.current = restored
        setDisplayQuantity(restored)
      } finally {
        isFlushingRef.current = false
        setIsUpdating(false)
      }
    }, [item.id, onUpdate])

    const changeBy = useCallback(
      (delta: number): void => {
        const next = Math.min(
          maximumQuantity,
          Math.max(1, desiredQuantityRef.current + delta)
        )
        if (next === desiredQuantityRef.current) {
          return
        }
        desiredQuantityRef.current = next
        setDisplayQuantity(next)
        void flush()
      },
      [flush, maximumQuantity]
    )

    const remove = useCallback(async (): Promise<void> => {
      if (!onRemove || isRemoving) {
        return
      }
      setIsRemoving(true)
      try {
        await onRemove(item.id)
      } catch {
        // The cart provider owns the customer-facing error toast. Keeping this
        // handler resolved prevents an unhandled rejection from a click event.
      } finally {
        setIsRemoving(false)
      }
    }, [isRemoving, item.id, onRemove])

    const decreaseQuantity = useCallback((): void => {
      changeBy(-1)
    }, [changeBy])

    const increaseQuantity = useCallback((): void => {
      changeBy(1)
    }, [changeBy])

    const removeItem = useCallback((): void => {
      void remove()
    }, [remove])

    const editable = Boolean(onRemove && onUpdate)
    const subtotal = item.unitPrice * displayQuantity

    return (
      <div
        className={cn(
          "grid grid-cols-[3.5rem_minmax(0,1fr)] gap-3 transition-opacity",
          isRemoving && "opacity-60"
        )}
        aria-busy={isRemoving || isUpdating}
      >
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-muted">
          {item.thumbnail ? (
            <Image
              src={item.thumbnail}
              alt=""
              fill
              sizes="56px"
              className="object-cover"
            />
          ) : null}
        </div>
        <div className="min-w-0">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm font-semibold text-foreground">
                {item.productTitle}
              </p>
              {item.variantTitle ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.variantTitle}
                </p>
              ) : null}
            </div>
            <p className="shrink-0 text-sm font-semibold text-foreground">
              {formatAmount(currencyCode, subtotal)}
            </p>
          </div>

          {editable ? (
            <div className="mt-3 flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="p-0"
                aria-label={`Decrease quantity of ${item.productTitle}`}
                onClick={decreaseQuantity}
                disabled={isRemoving || displayQuantity <= 1}
              >
                <Minus className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <output
                className="min-w-7 text-center text-sm font-semibold tabular-nums"
                aria-live="polite"
              >
                {displayQuantity}
              </output>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="p-0"
                aria-label={`Increase quantity of ${item.productTitle}`}
                onClick={increaseQuantity}
                disabled={isRemoving || displayQuantity >= maximumQuantity}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="ml-auto p-0 text-muted-foreground hover:text-destructive"
                aria-label={`Remove ${item.productTitle}`}
                onClick={removeItem}
                disabled={isRemoving || isUpdating}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              Qty {item.quantity}
            </p>
          )}
        </div>
      </div>
    )
  }
)
CheckoutSummaryItem.displayName = "CheckoutSummaryItem"

const SummaryRow = ({
  label,
  value,
  emphasized = false,
}: {
  label: string
  value: string
  emphasized?: boolean
}) => (
  <div
    className={
      emphasized
        ? "flex items-center justify-between border-t border-border/60 pt-4 text-base font-semibold text-foreground"
        : "flex items-center justify-between text-sm"
    }
  >
    <dt className={emphasized ? undefined : "text-muted-foreground"}>
      {label}
    </dt>
    <dd className="font-semibold text-foreground">{value}</dd>
  </div>
)

export const CheckoutSummary = memo<CheckoutSummaryProps>(
  ({
    checkout,
    onRemoveItem,
    onUpdateItem,
    expanded = true,
    onExpandedChange,
    className,
  }) => {
    const { items, totals } = checkout.cart
    const detailsId = useId()
    const format = (amount: number): string =>
      formatAmount(totals.currencyCode, amount)
    const toggleExpanded = useCallback((): void => {
      onExpandedChange?.(!expanded)
    }, [expanded, onExpandedChange])

    return (
      <Card
        as="aside"
        variant="panel"
        aria-label="Order summary"
        className={cn("overflow-hidden lg:sticky lg:top-24", className)}
      >
        <div className="flex items-center justify-between gap-3 p-5">
          <div>
            <p className="font-headline text-base uppercase tracking-[0.28rem] text-foreground">
              Order summary
            </p>
            <p className="mt-1 text-sm font-semibold text-foreground lg:hidden">
              {format(totals.total)}
            </p>
          </div>
          {onExpandedChange ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-expanded={expanded}
              aria-controls={detailsId}
              aria-label={
                expanded ? "Hide order summary" : "Show order summary"
              }
              onClick={toggleExpanded}
            >
              <ChevronDown
                className={`h-5 w-5 transition-transform motion-reduce:transition-none ${
                  expanded ? "rotate-180" : ""
                }`}
                aria-hidden="true"
              />
            </Button>
          ) : null}
        </div>

        <div id={detailsId} className={expanded ? "block" : "hidden lg:block"}>
          <div className="space-y-4 border-t border-border/60 px-5 py-5">
            {items.map((item) => (
              <CheckoutSummaryItem
                key={item.id}
                item={item}
                currencyCode={totals.currencyCode}
                onRemove={onRemoveItem}
                onUpdate={onUpdateItem}
              />
            ))}
          </div>

          <dl className="space-y-3 border-t border-border/60 px-5 py-5">
            <SummaryRow label="Subtotal" value={format(totals.subtotal)} />
            {totals.discountTotal > 0 ? (
              <SummaryRow
                label="Discount"
                value={`−${format(totals.discountTotal)}`}
              />
            ) : null}
            <SummaryRow
              label="Shipping"
              value={
                checkout.cart.shippingMethod
                  ? format(totals.shippingTotal)
                  : "Calculated next"
              }
            />
            <SummaryRow
              label="Tax"
              value={
                checkout.cart.shippingMethod
                  ? format(totals.taxTotal)
                  : "Calculated next"
              }
            />
            <SummaryRow label="Total" value={format(totals.total)} emphasized />
          </dl>

          <div className="flex flex-col gap-3 border-t border-border/60 px-5 py-5">
            <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              Secure payment powered by Stripe
            </p>
          </div>
        </div>
      </Card>
    )
  }
)
CheckoutSummary.displayName = "CheckoutSummary"
