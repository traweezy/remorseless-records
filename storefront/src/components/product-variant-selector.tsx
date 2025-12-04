"use client"

import { useEffect, useMemo, useState, useTransition } from "react"

import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { addToCart } from "@/lib/actions/add-to-cart"
import { formatAmount } from "@/lib/money"
import { cn } from "@/lib/ui/cn"
import type { VariantOption } from "@/types/product"

type ProductVariantSelectorProps = {
  variants: VariantOption[]
  productTitle: string
  redirectPath: string
}

const ProductVariantSelector = ({
  variants,
  productTitle,
  redirectPath,
}: ProductVariantSelectorProps) => {
  const [selectedVariantId, setSelectedVariantId] = useState(
    variants[0]?.id ?? ""
  )
  const [quantity, setQuantity] = useState(1)
  const [optimisticVariantId, setOptimisticVariantId] = useState<string | null>(
    null
  )
  const [isPending, startTransition] = useTransition()

  const selectedVariant = useMemo(
    () => variants.find((variant) => variant.id === selectedVariantId) ?? null,
    [selectedVariantId, variants]
  )

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
    setSelectedVariantId(variantId)
  }

  const handleQuantityChange = (value: string) => {
    const parsed = Number(value)
    if (Number.isNaN(parsed)) {
      setQuantity(1)
      return
    }

    const clamped = Math.min(Math.max(parsed, 1), 99)
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

    if (!selectedVariant.inStock) {
      toast.error("That variant is currently sold out.")
      return
    }

    setOptimisticVariantId(selectedVariant.id)

    startTransition(async () => {
      try {
        await addToCart({
          variantId: selectedVariant.id,
          quantity,
          redirectTo: redirectPath,
        })
        toast.success(`${productTitle} added to cart.`)
      } catch (error) {
        console.error(error)
        setOptimisticVariantId(null)
        toast.error("Failed to add to cart. Please try again.")
      }
    })
  }

  const addButtonLabel = (() => {
    if (!variants.length) {
      return "Coming soon"
    }

    if (!selectedVariant?.inStock) {
      return "Sold out"
    }

    if (isPending) {
      return "Adding…"
    }

    if (optimisticVariantId === selectedVariant?.id) {
      return "Added!"
    }

    return "Add to cart"
  })()

  const priceDisplay = selectedVariant
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
              const variantPrice = formatAmount(variant.currency, variant.amount)
              const isSoldOut = !variant.inStock

              return (
                <button
                  key={variant.id}
                  type="button"
                  className={cn(
                    "flex flex-col items-start gap-2 rounded-2xl border border-border/60 bg-background/70 p-3.5 text-left transition",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                    isSelected && !isSoldOut && "border-accent bg-accent/10",
                    isSoldOut && "cursor-not-allowed opacity-50"
                  )}
                  disabled={isSoldOut}
                  onClick={() => handleVariantSelect(variant.id)}
                >
                  <span className="font-headline text-sm uppercase tracking-[0.3rem] text-foreground">
                    {variant.title}
                  </span>
                  <span className="text-xs uppercase tracking-[0.25rem] text-muted-foreground">
                    {variantPrice}
                  </span>
                  <span
                    className={cn(
                      "text-[0.65rem] uppercase tracking-[0.3rem]",
                      isSoldOut ? "text-destructive" : "text-success"
                    )}
                  >
                    {isSoldOut ? "Sold out" : "In stock"}
                  </span>
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
            ) : null}
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
              max={99}
              inputMode="numeric"
              pattern="[0-9]*"
              className="h-11 w-20 rounded-full border border-border/60 bg-background/80 px-4 text-sm uppercase tracking-[0.2rem] shadow-inner focus-visible:outline focus-visible:outline-2 focus-visible:outline-destructive"
              type="number"
              value={quantity}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => handleQuantityChange(event.target.value)}
            />
          </label>
          <Button
            type="button"
            size="lg"
            className="flex-1 text-xs uppercase tracking-[0.35rem]"
            onClick={handleAddToCart}
            disabled={!variants.length || !selectedVariant?.inStock || isPending}
          >
            {addButtonLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default ProductVariantSelector
