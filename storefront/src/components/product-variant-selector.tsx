"use client"

import { useEffect, useMemo, useState, useTransition } from "react"

import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { formatAmount } from "@/lib/money"
import { cn } from "@/lib/ui/cn"
import { useCart } from "@/providers/cart-provider"
import type { VariantOption } from "@/types/product"

type ProductVariantSelectorProps = {
  variants: VariantOption[]
  productTitle: string
}

const resolveMaxQuantity = (variant: VariantOption | null): number => {
  const inventory = variant?.inventoryQuantity
  if (typeof inventory === "number" && Number.isFinite(inventory)) {
    return Math.max(0, Math.trunc(inventory))
  }
  return 99
}

const clampQuantity = (value: number, max: number) =>
  Math.min(Math.max(value, 1), max)

const resolveStockChip = (
  variant: VariantOption
): { label: string; tone: string } | null => {
  if (!variant.hasPrice) {
    return {
      label: "Unavailable",
      tone: "border-border/70 bg-background/60 text-muted-foreground",
    }
  }

  if (variant.stockStatus === "sold_out") {
    return {
      label: "Sold out",
      tone: "border-destructive/70 bg-destructive/20 text-destructive",
    }
  }

  if (variant.stockStatus === "low_stock") {
    return {
      label:
        variant.inventoryQuantity && variant.inventoryQuantity > 0
          ? `Only ${variant.inventoryQuantity} left`
          : "Low stock",
      tone: "border-amber-400/70 bg-amber-500/15 text-amber-200",
    }
  }

  return null
}

const ProductVariantSelector = ({
  variants,
  productTitle,
}: ProductVariantSelectorProps) => {
  const defaultVariantId = useMemo(() => {
    const purchasable = variants.find((variant) => variant.inStock && variant.hasPrice)
    if (purchasable) return purchasable.id
    const priced = variants.find((variant) => variant.hasPrice)
    if (priced) return priced.id
    return variants[0]?.id ?? ""
  }, [variants])

  const [selectedVariantId, setSelectedVariantId] = useState(defaultVariantId)
  const [quantity, setQuantity] = useState(1)
  const [optimisticVariantId, setOptimisticVariantId] = useState<string | null>(
    null
  )
  const [isPending, startTransition] = useTransition()
  const { addItem } = useCart()

  const resolvedVariantId =
    selectedVariantId && variants.some((variant) => variant.id === selectedVariantId)
      ? selectedVariantId
      : defaultVariantId

  const selectedVariant = useMemo(
    () => variants.find((variant) => variant.id === resolvedVariantId) ?? null,
    [resolvedVariantId, variants]
  )

  const maxQuantity = useMemo(() => {
    return resolveMaxQuantity(selectedVariant)
  }, [selectedVariant])

  const isPurchasable = Boolean(selectedVariant?.inStock && selectedVariant?.hasPrice)
  const effectiveMax = Math.max(1, maxQuantity)
  const safeQuantity = isPurchasable ? clampQuantity(quantity, effectiveMax) : 1

  useEffect(() => {
    if (!isPending && optimisticVariantId) {
      const timer = setTimeout(() => {
        setOptimisticVariantId(null)
      }, 1600)

      return () => clearTimeout(timer)
    }

    return undefined
  }, [isPending, optimisticVariantId])

  const handleVariantSelect = (variantId: string) => {
    const nextVariant = variants.find((variant) => variant.id === variantId) ?? null
    const nextMax = Math.max(1, resolveMaxQuantity(nextVariant))
    setSelectedVariantId(variantId)
    setQuantity((prev) => clampQuantity(prev, nextMax))
  }

  const handleQuantityChange = (value: string) => {
    const parsed = Number(value)
    if (Number.isNaN(parsed)) {
      setQuantity(1)
      return
    }

    const clamped = clampQuantity(parsed, effectiveMax)
    setQuantity(clamped)
  }

  const handleAddToCart = () => {
    if (!variants.length) {
      toast.error("All variants are coming soon. Check back shortly.")
      return
    }

    if (!selectedVariant) {
      toast.error("Select a variant before adding to cart.")
      return
    }

    if (!selectedVariant.hasPrice) {
      toast.error("Pricing for this format is unavailable right now.")
      return
    }

    if (!selectedVariant.inStock) {
      toast.error("That variant is currently sold out.")
      return
    }

    if (safeQuantity !== quantity) {
      setQuantity(safeQuantity)
    }

    setOptimisticVariantId(selectedVariant.id)

    startTransition(async () => {
      try {
        await addItem(selectedVariant.id, safeQuantity)
        toast.success(`${productTitle} added to cart.`)
      } catch (error) {
        console.error(error)
        toast.error("Unable to add this item right now.")
        setOptimisticVariantId(null)
      }
    })
  }

  const addButtonLabel = (() => {
    if (!variants.length) {
      return "Coming soon"
    }

    if (!selectedVariant?.hasPrice) {
      return "Unavailable"
    }

    if (!selectedVariant?.inStock) {
      return "Sold out"
    }

    if (isPending) {
      return "Adding..."
    }

    if (optimisticVariantId === selectedVariant?.id) {
      return "Added!"
    }

    return "Add to cart"
  })()

  const priceDisplay = selectedVariant?.hasPrice
    ? formatAmount(selectedVariant.currency, selectedVariant.amount)
    : null

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h2 className="font-headline text-[0.7rem] uppercase tracking-[0.4rem] text-muted-foreground">
          Format
        </h2>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {variants.length ? (
            variants.map((variant) => {
              const isSelected = variant.id === selectedVariant?.id
              const variantPrice = variant.hasPrice
                ? formatAmount(variant.currency, variant.amount)
                : "Price unavailable"
              const isSoldOut = variant.stockStatus === "sold_out"
              const isUnavailable = !variant.hasPrice
              const stockChip = resolveStockChip(variant)

              return (
                <button
                  key={variant.id}
                  type="button"
                  className={cn(
                    "flex flex-col items-start gap-2 rounded-2xl border border-border/60 bg-background/70 p-3.5 text-left transition",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                    isSelected && !isSoldOut && !isUnavailable && "border-accent bg-accent/10",
                    (isSoldOut || isUnavailable) && "cursor-not-allowed opacity-50"
                  )}
                  disabled={isSoldOut || isUnavailable}
                  onClick={() => handleVariantSelect(variant.id)}
                >
                  <span className="font-headline text-sm uppercase tracking-[0.3rem] text-foreground">
                    {variant.title}
                  </span>
                  <span className="text-xs uppercase tracking-[0.25rem] text-muted-foreground">
                    {variantPrice}
                  </span>
                  {stockChip ? (
                    <span
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[0.6rem] uppercase tracking-[0.3rem]",
                        stockChip.tone
                      )}
                    >
                      {stockChip.label}
                    </span>
                  ) : null}
                </button>
              )
            })
          ) : (
            <div className="rounded-2xl border border-border/60 bg-background/70 p-4 text-sm text-muted-foreground">
              All formats are currently in production. Join the newsletter to be alerted when
              the next pressing drops.
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-border/60 bg-surface/80 p-5 shadow-elegant">
        <div className="flex flex-col gap-2">
          <p className="font-headline text-xs uppercase tracking-[0.35rem] text-muted-foreground">
            Selected Format
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-display text-3xl uppercase tracking-[0.3rem] text-foreground">
              {selectedVariant?.title ?? "None"}
            </span>
            {priceDisplay ? (
              <span className="rounded-full border border-border/60 px-3 py-1 text-xs uppercase tracking-[0.3rem] text-accent">
                {priceDisplay}
              </span>
            ) : (
              <span className="rounded-full border border-border/60 px-3 py-1 text-xs uppercase tracking-[0.3rem] text-muted-foreground">
                Price unavailable
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label
            className="flex items-center gap-2 text-xs uppercase tracking-[0.3rem] text-muted-foreground"
            htmlFor="quantity"
          >
            Qty
            <input
              id="quantity"
              min={1}
              max={effectiveMax}
              inputMode="numeric"
              pattern="[0-9]*"
              className="h-11 w-20 rounded-full border border-border/60 bg-background/80 px-4 text-sm uppercase tracking-[0.2rem] shadow-inner focus-visible:outline focus-visible:outline-2 focus-visible:outline-destructive"
              type="number"
              value={safeQuantity}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => handleQuantityChange(event.target.value)}
              disabled={!isPurchasable}
            />
          </label>
          <Button
            type="button"
            size="lg"
            className="flex-1 text-xs uppercase tracking-[0.35rem]"
            onClick={handleAddToCart}
            disabled={!variants.length || !isPurchasable || isPending}
          >
            {addButtonLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default ProductVariantSelector
