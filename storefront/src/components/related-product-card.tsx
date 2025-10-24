"use client"

import { useEffect, useState, useTransition } from "react"
import Link from "next/link"

import { toast } from "sonner"

import { addToCart } from "@/lib/actions/add-to-cart"
import { formatAmount } from "@/lib/money"
import { cn } from "@/lib/ui/cn"
import type { RelatedProductSummary } from "@/types/product"

type RelatedProductCardProps = {
  product: RelatedProductSummary
}

const RelatedProductCard = ({ product }: RelatedProductCardProps) => {
  const { defaultVariant } = product
  const [optimistic, setOptimistic] = useState(false)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (!optimistic) {
      return undefined
    }

    const timer = setTimeout(() => setOptimistic(false), 1600)
    return () => clearTimeout(timer)
  }, [optimistic])

  const handleQuickAdd = () => {
    if (!defaultVariant) {
      toast.error("No purchasable variant available.")
      return
    }

    if (!defaultVariant.inStock) {
      toast.error("This release is currently sold out.")
      return
    }

    setOptimistic(true)

    startTransition(async () => {
      try {
        await addToCart({
          variantId: defaultVariant.id,
          quantity: 1,
          redirectTo: `/products/${product.handle}`,
        })
        toast.success(`${product.title} added to cart.`)
      } catch (error) {
        console.error(error)
        setOptimistic(false)
        toast.error("Unable to add to cart. Please try again.")
      }
    })
  }

  const priceDisplay =
    defaultVariant &&
    formatAmount(defaultVariant.currency, defaultVariant.amount)

  const isDisabled =
    !defaultVariant?.inStock || isPending

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-border/60 bg-surface/70 transition hover:border-accent hover:shadow-glow">
      <div className="relative aspect-square overflow-hidden bg-background/50">
        {product.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.thumbnail}
            alt={product.title}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            No artwork
          </div>
        )}
        {product.collectionTitle ? (
          <span className="absolute left-4 top-4 rounded-full border border-border/70 bg-background/80 px-3 py-1 text-[0.6rem] uppercase tracking-[0.35rem] text-muted-foreground shadow-elegant">
            {product.collectionTitle}
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-3 px-4 py-5">
        <div className="flex flex-col gap-1">
          <Link
            href={`/products/${product.handle}`}
            className="font-headline text-base uppercase tracking-[0.35rem] text-foreground transition hover:text-accent"
          >
            {product.title}
          </Link>
          {priceDisplay ? (
            <span className="text-sm font-semibold text-accent">
              {priceDisplay}
            </span>
          ) : (
            <span className="text-xs uppercase tracking-[0.25rem] text-muted-foreground">
              Coming soon
            </span>
          )}
        </div>
        <div className="mt-auto flex items-center justify-between gap-2">
          <Link
            href={`/products/${product.handle}`}
            className="inline-flex items-center rounded-full border border-border/70 px-4 py-1 text-[0.6rem] uppercase tracking-[0.3rem] text-muted-foreground transition hover:border-accent hover:text-accent"
          >
            View
          </Link>
          <button
            type="button"
            onClick={handleQuickAdd}
            disabled={isDisabled}
            className={cn(
              "inline-flex items-center rounded-full border px-4 py-1 text-[0.6rem] uppercase tracking-[0.3rem] transition",
              defaultVariant?.inStock
                ? "border-accent text-accent hover:bg-accent hover:text-background"
                : "border-border/60 text-muted-foreground",
              (isPending || optimistic) && "cursor-default"
            )}
          >
            {defaultVariant?.inStock
              ? optimistic
                ? "Added!"
                : isPending
                  ? "Adding…"
                  : "Quick add"
              : "Sold out"}
          </button>
        </div>
      </div>
    </article>
  )
}

export default RelatedProductCard
