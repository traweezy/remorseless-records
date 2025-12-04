"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, type MouseEvent } from "react"

import type { HttpTypes } from "@medusajs/types"
import { ShoppingCart } from "lucide-react"

import { ProductQuickView } from "@/components/product-quick-view"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { mapStoreProductToRelatedSummary } from "@/lib/products/transformers"
import type { ProductSearchHit, RelatedProductSummary } from "@/types/product"

type StoreProduct = HttpTypes.StoreProduct
type ProductCardSource = StoreProduct | ProductSearchHit | RelatedProductSummary

const isStoreProduct = (product: ProductCardSource): product is StoreProduct =>
  "variants" in product

const isProductSearchHitSource = (product: ProductCardSource): product is ProductSearchHit =>
  "variantTitles" in product && Array.isArray(product.variantTitles)

const slugify = (value: string | null | undefined): string | null => {
  if (!value || typeof value !== "string") {
    return null
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return normalized.length ? normalized : null
}

const toStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => Boolean(entry.length))
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => Boolean(entry.length))
  }
  return []
}

type RibbonCandidate = {
  label: string
  slug: string
}

const coerceMetadata = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null

const addCandidate = (list: RibbonCandidate[], label: string | null | undefined, slugSource?: string | null) => {
  if (!label || !label.trim().length) {
    return
  }
  const slug = slugify(slugSource ?? label)
  if (!slug) {
    return
  }
  if (list.some((candidate) => candidate.slug === slug)) {
    return
  }
  list.push({ label: label.trim(), slug })
}

const COLLECTION_PRIORITY = [
  "featured",
  "featured-picks",
  "featured-pressings",
  "staff-signals",
  "staff-picks",
  "staff",
  "new-releases",
  "new-arrivals",
  "latest",
  "exclusive",
] as const

const GENERIC_COLLECTION_SLUGS = new Set(["music", "metal", "genres", "artists", "bundles", "merch"])

const resolveCollectionRibbonLabel = (
  product: ProductCardSource,
  summary: RelatedProductSummary
): string | null => {
  const candidates: RibbonCandidate[] = []

  if (isStoreProduct(product)) {
    const collection = product.collection
    if (collection) {
      addCandidate(candidates, typeof collection.title === "string" ? collection.title : null, collection.handle)
    }

    const metadata = coerceMetadata(product.metadata)
    if (metadata) {
      const metadataCandidates = [
        ...toStringArray(metadata["ribbonLabel"]),
        ...toStringArray(metadata["collections"]),
        ...(typeof metadata["collection"] === "string" ? [metadata["collection"]] : []),
      ]
      metadataCandidates.forEach((entry) => addCandidate(candidates, entry))
    }

    const tagCandidates =
      product.tags
        ?.map((tag) => (typeof tag?.value === "string" ? tag.value.trim() : ""))
        .filter((value): value is string => Boolean(value)) ?? []
    tagCandidates.forEach((entry) => addCandidate(candidates, entry))
  }

  addCandidate(candidates, summary.collectionTitle)

  let filtered = candidates.filter((candidate) => !GENERIC_COLLECTION_SLUGS.has(candidate.slug))
  if (!filtered.length) {
    filtered = []
  }

  if (!filtered.length) {
    return null
  }

  for (const priority of COLLECTION_PRIORITY) {
    const match = filtered.find(
      (candidate) => candidate.slug === priority || candidate.slug.startsWith(priority)
    )
    if (match) {
      return match.label
    }
  }

  return filtered[0]?.label ?? null
}

const resolveFallbackBadge = (product: ProductCardSource): string | null => {
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

const resolveBadge = (
  product: ProductCardSource,
  summary: RelatedProductSummary
): string | null => {
  return resolveCollectionRibbonLabel(product, summary) ?? resolveFallbackBadge(product)
}

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

  const summary = isStoreProduct(product)
    ? mapStoreProductToRelatedSummary(product)
    : product

  const handle = summary.handle?.trim() ?? ""

  if (!handle.length) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[product-card] Skipping render for product without handle`,
        { id: summary.id }
      )
    }
    return null
  }
  const badge = resolveBadge(product, summary)
  const thumbnail = resolveThumbnail(product)
  const initialProduct = isStoreProduct(product) ? product : undefined
  const productHref = handle ? `/products/${handle}` : "/products"
  const formatLabels = (() => {
    const labels = new Set<string>()

    const addLabel = (value: string | null | undefined) => {
      if (!value) {
        return
      }
      const normalized = value.trim()
      if (!normalized.length || normalized.toLowerCase() === "default") {
        return
      }
      labels.add(normalized)
    }

    if (isStoreProduct(product)) {
      product.variants?.forEach((variant) => addLabel(variant?.title))
      product.options?.forEach((option) => {
        if (option?.title?.toLowerCase() === "format") {
          option.values?.forEach((entry) => addLabel(typeof entry?.value === "string" ? entry.value : null))
        }
      })
      product.tags?.forEach((tag) => addLabel(tag?.value))
      const metadata = coerceMetadata(product.metadata)
      if (metadata) {
        addLabel(typeof metadata?.format === "string" ? metadata.format : null)
        addLabel(typeof metadata?.packaging === "string" ? metadata.packaging : null)
      }
    } else if (isProductSearchHitSource(product)) {
      product.variantTitles.forEach(addLabel)
      addLabel(product.format)
    } else {
      summary.formats.forEach(addLabel)
    }

    if (!labels.size) {
      summary.formats.forEach(addLabel)
    }

    if (!labels.size && summary.defaultVariant?.title) {
      addLabel(summary.defaultVariant.title)
    }

    return Array.from(labels)
  })()

  const triggerPrefetch = () => {
    if (!handle) {
      return
    }

    void router.prefetch(productHref)
  }

  const handleQuickShop = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setQuickShopOpen(true)
  }

  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
    if (!summary.genres.length) {
      console.warn("[ProductCard] missing genres", {
        handle: summary.handle,
        sourceType: isStoreProduct(product)
          ? "store"
          : isProductSearchHitSource(product)
            ? "search-hit"
            : "summary",
        rawGenres: isProductSearchHitSource(product) ? product.genres : undefined,
        rawMetalGenres: isProductSearchHitSource(product) ? product.metalGenres : undefined,
      })
    }
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
          prefetch
          data-prefetch="true"
          className="block h-full focus:outline-none"
          aria-label={`View ${summary.title}`}
        >
          <Card className="relative flex h-full flex-col overflow-visible rounded-[1.75rem] border-2 border-border/60 bg-background/80 shadow-[0_22px_55px_-32px_rgba(0,0,0,0.75)] transition hover:-translate-y-1 hover:border-border/60 hover:shadow-[0_28px_70px_-40px_rgba(0,0,0,0.7)] focus-within:-translate-y-1 focus-within:border-border/60 focus-within:shadow-[0_28px_70px_-40px_rgba(0,0,0,0.7)]">
            {badge ? (
              <div className="product-card__corner" aria-label={`Collection: ${badge}`}>
                <span>{badge.toUpperCase()}</span>
              </div>
            ) : null}
            <div className="flex h-full flex-col overflow-hidden rounded-[inherit] bg-surface/95">
              <div className="relative z-10 aspect-square overflow-hidden bg-card">
                {thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumbnail}
                    alt={summary.album ?? summary.title}
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.06] group-hover:rotate-[1.8deg] group-hover:brightness-[0.75] group-focus-within:scale-[1.06] group-focus-within:rotate-[1.8deg] group-focus-within:brightness-[0.75]"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs uppercase tracking-[0.3rem] text-muted-foreground">
                    No artwork
                  </div>
                )}
                <div className="pointer-events-none absolute inset-0 z-30 flex items-end justify-center p-6 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                  <Button
                    type="button"
                    variant="default"
                    className="pointer-events-auto inline-flex items-center gap-2 rounded-full px-6 py-2 text-xs uppercase tracking-[0.3rem] shadow-glow focus-visible:ring-2 focus-visible:ring-destructive/70"
                    onClick={handleQuickShop}
                    onFocus={triggerPrefetch}
                    aria-label={`Quick shop ${summary.album ?? summary.title}`}
                  >
                    <ShoppingCart className="h-4 w-4" aria-hidden="true" />
                    <span>Quick shop</span>
                  </Button>
                </div>
              </div>
              <div className="flex flex-1 flex-col justify-between px-5 py-6">
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.35rem] text-muted-foreground">
                    {summary.subtitle ?? summary.artist}
                  </p>
                  <h3 className="font-bebas text-2xl uppercase tracking-[0.35rem] text-foreground">
                    {summary.title}
                  </h3>
                </div>
                {formatLabels.length ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {Array.from(
                      new Map(
                        formatLabels.map((label) => {
                          const normalized = label.trim()
                          const display = normalized.toLowerCase().includes("bundle")
                            ? "Bundle"
                            : normalized
                          return [display.toLowerCase(), display]
                        })
                      ).values()
                    ).map((label) => (
                      <Badge
                        key={`${summary.id}-${label}`}
                        variant="outline"
                        className="flex min-h-[1.75rem] items-center justify-center rounded-full border-border/40 bg-background/85 px-3 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.28rem] text-foreground"
                      >
                        <span className="text-center leading-none">{label.toUpperCase()}</span>
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
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
