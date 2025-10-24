"use client"

import Link from "next/link"

import type { HttpTypes } from "@medusajs/types"
import { Eye, ShoppingCart } from "lucide-react"
import { useState } from "react"

import { ProductQuickView } from "@/components/product-quick-view"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { formatAmount } from "@/lib/money"

type ProductCardProps = {
  product: HttpTypes.StoreProduct
}

const resolvePrice = (product: HttpTypes.StoreProduct) => {
  const variant = product.variants?.[0]
  const calculated = variant?.calculated_price

  const amount = calculated?.calculated_amount ?? calculated?.original_amount ?? 0
  const currency = calculated?.currency_code ?? "usd"

  return {
    amount,
    currency,
  }
}

const resolveBadge = (product: HttpTypes.StoreProduct): string | null => {
  const badge = typeof product.metadata?.badge === "string" ? product.metadata.badge : null
  if (badge) {
    return badge
  }

  const tagLabel = product.tags?.find((tag) => tag?.value && tag.value.toLowerCase().includes("limited"))
  if (tagLabel) {
    return "Limited"
  }

  if (product.tags?.some((tag) => tag?.value?.toLowerCase().includes("new"))) {
    return "New"
  }

  return null
}

export const ProductCard = ({ product }: ProductCardProps) => {
  const [quickViewOpen, setQuickViewOpen] = useState(false)
  const badge = resolveBadge(product)
  const { amount, currency } = resolvePrice(product)

  return (
    <Card className="group relative overflow-hidden border-2 border-border/60 hover:border-destructive">
      {badge ? (
        <Badge
          variant="destructive"
          className="absolute right-3 top-3 z-10 rotate-2 px-3 py-1 font-headline text-xs tracking-[0.35rem] shadow-glow sm:right-4 sm:top-4"
        >
          {badge.toUpperCase()}
        </Badge>
      ) : null}
      <CardContent className="p-0">
        <div className="relative aspect-square overflow-hidden bg-card">
          <Link href={`/products/${product.handle ?? product.id}`}>
            {product.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.thumbnail}
                alt={product.title ?? "Release artwork"}
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                loading="lazy"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs uppercase tracking-[0.3rem] text-muted-foreground">
                No artwork
              </div>
            )}
          </Link>
          <div className="absolute inset-0 flex items-center justify-center gap-3 opacity-0 transition group-hover:opacity-100">
            <Button
              size="icon"
              variant="ghost"
              className="rounded-full border border-border/70 bg-background/90 hover:bg-background"
              onClick={() => setQuickViewOpen(true)}
              aria-label={`Quick view ${product.title}`}
            >
              <Eye className="h-5 w-5" />
            </Button>
            <Button
              size="icon"
              className="rounded-full bg-destructive hover:bg-destructive/90"
              asChild
            >
              <Link href={`/products/${product.handle ?? product.id}`} aria-label={`View ${product.title}`}>
                <ShoppingCart className="h-5 w-5" />
              </Link>
            </Button>
          </div>
        </div>
        <div className="space-y-3 px-5 py-6">
          <div className="space-y-1">
            <h3 className="font-bebas text-2xl uppercase tracking-[0.35rem] text-foreground">
              {product.title}
            </h3>
            <p className="text-xs uppercase tracking-[0.25rem] text-muted-foreground">
              {product.subtitle ?? product.collection?.title ?? "Underground release"}
            </p>
          </div>
          <div className="flex items-center justify-between text-sm font-semibold uppercase tracking-[0.3rem]">
            <span className="text-destructive">
              {formatAmount(currency, amount)}
            </span>
            <span className="rounded-full border border-border/50 px-3 py-1 text-[0.6rem] text-muted-foreground">
              {product.collection?.title ?? "Exclusive"}
            </span>
          </div>
        </div>
      </CardContent>
      <ProductQuickView
        product={product}
        open={quickViewOpen}
        onOpenChange={setQuickViewOpen}
      />
    </Card>
  )
}

export default ProductCard
