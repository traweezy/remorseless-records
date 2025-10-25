"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, type MouseEvent } from "react"

import type { HttpTypes } from "@medusajs/types"
import { ShoppingCart } from "lucide-react"

import { ProductQuickView } from "@/components/product-quick-view"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { formatAmount } from "@/lib/money"
import { useProductDetailPrefetch } from "@/lib/query/products"
import { cn } from "@/lib/ui/cn"
import type { ProductSearchHit, RelatedProductSummary } from "@/types/product"

type StoreProduct = HttpTypes.StoreProduct
type ProductCardSource = StoreProduct | ProductSearchHit | RelatedProductSummary

const isStoreProduct = (product: ProductCardSource): product is StoreProduct =>
  "variants" in product

const resolveHandle = (product: ProductCardSource): string =>
  product.handle ?? product.id

const resolveBadge = (product: ProductCardSource): string | null => {
  if (!isStoreProduct(product)) {
    return null
  }

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

const resolvePriceLabel = (product: ProductCardSource): string | null => {
  if (isStoreProduct(product)) {
    const variant = product.variants?.[0]
    const calculated = variant?.calculated_price

    const amount = calculated?.calculated_amount ?? calculated?.original_amount
    const currency = calculated?.currency_code

    if (amount == null || currency == null) {
      return null
    }

    return formatAmount(currency, amount)
  }

  const variant = product.defaultVariant
  if (!variant) {
    return null
  }

  return formatAmount(variant.currency, variant.amount)
}

const resolveCollectionLabel = (product: ProductCardSource): string =>
  isStoreProduct(product)
    ? product.collection?.title ?? "Exclusive"
    : product.collectionTitle ?? "Exclusive"

const resolveSubtitle = (product: ProductCardSource): string =>
  isStoreProduct(product)
    ? product.subtitle ?? product.collection?.title ?? "Underground release"
    : product.collectionTitle ?? "Underground release"

const resolveThumbnail = (product: ProductCardSource): string | null =>
  isStoreProduct(product)
    ? product.thumbnail ??
      product.images?.find((image) => typeof image?.url === "string")?.url ??
      null
    : product.thumbnail ?? null

type ProductCardProps = {
  product: ProductCardSource
}

export const ProductCard = ({ product }: ProductCardProps) => {
  const router = useRouter()
  const [quickShopOpen, setQuickShopOpen] = useState(false)

  const handle = resolveHandle(product)
  const title = product.title ?? "Release"
  const badge = resolveBadge(product)
  const priceLabel = resolvePriceLabel(product)
  const collectionLabel = resolveCollectionLabel(product)
  const subtitle = resolveSubtitle(product)
  const thumbnail = resolveThumbnail(product)
  const initialProduct = isStoreProduct(product) ? product : undefined
  const productHref = handle ? `/products/${handle}` : "/products"

  const prefetchProduct = useProductDetailPrefetch(handle)

  const triggerPrefetch = () => {
    if (!handle) {
      return
    }

    void router.prefetch(productHref)
    prefetchProduct()
  }

  const handleQuickShop = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setQuickShopOpen(true)
  }

  return (
    <>
      <div
        className="group relative h-full"
        onPointerEnter={triggerPrefetch}
        onFocusCapture={triggerPrefetch}
      >
        <Link
          href={productHref}
          data-prefetch="true"
          className="block h-full focus:outline-none"
          aria-label={`View ${title}`}
        >
          <Card className="relative flex h-full flex-col overflow-hidden border-2 border-border/60 transition duration-300 hover:border-destructive focus-within:border-destructive">
            {badge ? (
              <Badge
                variant="destructive"
                className="pointer-events-none absolute right-3 top-3 z-20 rotate-2 px-3 py-1 font-headline text-xs tracking-[0.35rem] shadow-glow sm:right-4 sm:top-4"
              >
                {badge.toUpperCase()}
              </Badge>
            ) : null}
            <CardContent className="flex h-full flex-col p-0">
              <div className="relative aspect-square overflow-hidden bg-card">
                {thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumbnail}
                    alt={title}
                    className="h-full w-full transform-gpu object-cover transition-transform duration-500 ease-out group-hover:scale-105 group-hover:rotate-[1.6deg] group-focus-within:scale-105 group-focus-within:rotate-[1.6deg]"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs uppercase tracking-[0.3rem] text-muted-foreground">
                    No artwork
                  </div>
                )}
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-background/90 via-background/70 to-background/20 opacity-0 transition-opacity duration-500 group-hover:opacity-100 group-focus-within:opacity-100" />
                <div className="pointer-events-none absolute inset-0 z-30 flex items-end justify-center p-6 opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-within:opacity-100">
                  <Button
                    type="button"
                    variant="default"
                    className="pointer-events-auto inline-flex items-center gap-2 rounded-full px-6 py-2 text-xs uppercase tracking-[0.3rem] shadow-glow focus-visible:ring-2 focus-visible:ring-destructive/70"
                    onClick={handleQuickShop}
                    onFocus={triggerPrefetch}
                    aria-label={`Quick shop ${title}`}
                  >
                    <ShoppingCart className="h-4 w-4" aria-hidden="true" />
                    <span>Quick shop</span>
                  </Button>
                </div>
              </div>
              <div className="flex flex-1 flex-col justify-between space-y-3 px-5 py-6">
                <div className="space-y-1">
                  <h3 className="font-bebas text-2xl uppercase tracking-[0.35rem] text-foreground">
                    {title}
                  </h3>
                  <p className="text-xs uppercase tracking-[0.25rem] text-muted-foreground">
                    {subtitle}
                  </p>
                </div>
                <div className="flex items-center justify-between text-sm font-semibold uppercase tracking-[0.3rem]">
                  <span className={cn("text-destructive", !priceLabel && "text-muted-foreground/70")}>
                    {priceLabel ?? "Coming soon"}
                  </span>
                  <span className="rounded-full border border-border/50 px-3 py-1 text-[0.6rem] text-muted-foreground">
                    {collectionLabel}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

      </div>

      <ProductQuickView
        handle={handle}
        open={quickShopOpen}
        onOpenChange={setQuickShopOpen}
        {...(initialProduct ? { initialProduct } : {})}
      />
    </>
  )
}

export default ProductCard
