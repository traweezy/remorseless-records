"use client"

import Image from "next/image"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, type MouseEvent } from "react"

import type { HttpTypes } from "@medusajs/types"
import { ShoppingCart } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { MediaPlaceholder } from "@/components/ui/media-placeholder"
import SmartLink from "@/components/ui/smart-link"
import { cn } from "@/lib/ui/cn"
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types"
import {
  deriveVariantOptions,
  mapStoreProductToRelatedSummary,
} from "@/lib/products/transformers"
import { resolveProductCardPrice } from "@/lib/products/card-price"
import { summarizeStockStatus } from "@/lib/products/stock"
import {
  buildPublicProductPath,
  resolvePublicProductRouteType,
} from "@/lib/products/routes"
import { normalizeRibbonLabel } from "@/lib/products/ribbons"
import { asUnknownRecord } from "@/lib/provider-boundary"
import { useProductDetailPrefetch } from "@/lib/query/products"
import { shouldBlockPrefetch } from "@/lib/prefetch"
import type {
  ProductSearchHit,
  RelatedProductSummary,
  StockStatus,
} from "@/types/product"

const loadProductQuickView = () => import("@/components/product-quick-view")
const ProductQuickView = dynamic(() =>
  loadProductQuickView().then((module) => module.ProductQuickView)
)

type StoreProduct = HttpTypes.StoreProduct
type ProductCardSource = StoreProduct | ProductSearchHit | RelatedProductSummary

const isStoreProduct = (product: ProductCardSource): product is StoreProduct =>
  "variants" in product

const isProductSearchHitSource = (
  product: ProductCardSource
): product is ProductSearchHit =>
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
  asUnknownRecord(value)

const addCandidate = (
  list: RibbonCandidate[],
  label: string | null | undefined,
  slugSource?: string | null
) => {
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

const GENERIC_COLLECTION_SLUGS = new Set([
  "music",
  "metal",
  "genres",
  "artists",
  "bundles",
  "merch",
])

export const resolveCollectionRibbonLabel = (
  product: ProductCardSource,
  summary: RelatedProductSummary
): string | null => {
  const candidates: RibbonCandidate[] = []

  if (isProductSearchHitSource(product)) {
    addCandidate(candidates, product.ribbonLabel)
  }

  if (isStoreProduct(product)) {
    const collection = product.collection
    if (collection) {
      addCandidate(
        candidates,
        typeof collection.title === "string" ? collection.title : null,
        collection.handle
      )
    }

    const metadata = coerceMetadata(product.metadata)
    if (metadata) {
      const metadataCandidates = [
        ...toStringArray(metadata["ribbonLabel"]),
        ...toStringArray(metadata["collections"]),
        ...(typeof metadata["collection"] === "string"
          ? [metadata["collection"]]
          : []),
      ]
      metadataCandidates.forEach((entry) => {
        addCandidate(candidates, entry)
      })
    }

    const tagCandidates =
      product.tags
        ?.map((tag) => (typeof tag?.value === "string" ? tag.value.trim() : ""))
        .filter((value): value is string => Boolean(value)) ?? []
    tagCandidates.forEach((entry) => {
      addCandidate(candidates, entry)
    })
  }

  addCandidate(candidates, summary.collectionTitle)

  let filtered = candidates.filter(
    (candidate) => !GENERIC_COLLECTION_SLUGS.has(candidate.slug)
  )
  if (!filtered.length) {
    filtered = []
  }

  if (!filtered.length) {
    return null
  }

  for (const priority of COLLECTION_PRIORITY) {
    const match = filtered.find(
      (candidate) =>
        candidate.slug === priority || candidate.slug.startsWith(priority)
    )
    if (match) {
      return normalizeRibbonLabel(match.label)
    }
  }

  return normalizeRibbonLabel(filtered[0]?.label)
}

const resolveFallbackBadge = (product: ProductCardSource): string | null => {
  if (!isStoreProduct(product)) {
    return null
  }

  const badge =
    typeof product.metadata?.badge === "string" ? product.metadata.badge : null
  if (badge) {
    return badge
  }

  const tagLabel = product.tags?.find(
    (tag) => tag?.value && tag.value.toLowerCase().includes("limited")
  )
  if (tagLabel) {
    return "Limited"
  }

  if (product.tags?.some((tag) => tag?.value?.toLowerCase().includes("new"))) {
    return "New"
  }

  return null
}

export const resolveProductCardBadge = (
  product: ProductCardSource,
  summary: RelatedProductSummary,
  contextualRibbonLabel?: string | null
): string | null => {
  const contextualRibbon = contextualRibbonLabel?.trim()
  if (contextualRibbon) {
    return normalizeRibbonLabel(contextualRibbon)
  }

  return (
    resolveCollectionRibbonLabel(product, summary) ??
    resolveFallbackBadge(product)
  )
}

const resolveThumbnail = (product: ProductCardSource): string | null =>
  isStoreProduct(product)
    ? (product.thumbnail ??
      product.images?.find((image) => typeof image?.url === "string")?.url ??
      null)
    : (product.thumbnail ?? null)

const resolveStockBadge = (
  status: StockStatus
): { label: string; className: string } | null => {
  switch (status) {
    case "sold_out":
      return {
        label: "Sold out",
        className:
          "border-destructive/80 bg-destructive text-destructive-foreground",
      }
    default:
      return null
  }
}

type ProductCardProps = {
  product: ProductCardSource
  onMediaLoad?: () => void
  ribbonLabel?: string | null
}

export const ProductCard = ({
  product,
  onMediaLoad,
  ribbonLabel,
}: ProductCardProps) => {
  const router = useRouter()
  const [quickShopOpen, setQuickShopOpen] = useState(false)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const prefetchProductDetail = useProductDetailPrefetch(
    isStoreProduct(product) ? product.handle : product.handle
  )

  const summary = isStoreProduct(product)
    ? mapStoreProductToRelatedSummary(product)
    : product

  const handle = summary.handle?.trim() ?? ""
  const variantOptions = isStoreProduct(product)
    ? deriveVariantOptions(product.variants)
    : summary.defaultVariant
      ? [summary.defaultVariant]
      : []
  const derivedStockStatus = summarizeStockStatus(variantOptions)
  const stockStatus =
    isProductSearchHitSource(product) && product.stockStatus
      ? product.stockStatus
      : derivedStockStatus
  const stockBadge = resolveStockBadge(stockStatus)
  const isSoldOut = stockStatus === "sold_out"
  const hasPrice = summary.defaultVariant?.hasPrice ?? false
  const isUnavailable = !hasPrice
  const canQuickShop = !isSoldOut && !isUnavailable
  const cardPrice = resolveProductCardPrice({
    currency: summary.defaultVariant?.currency ?? null,
    indexedMax: isProductSearchHitSource(product)
      ? (product.priceMax ?? null)
      : null,
    indexedMin: isProductSearchHitSource(product)
      ? (product.priceMin ?? null)
      : null,
    stockStatus,
    variants: isProductSearchHitSource(product) ? [] : variantOptions,
  })
  const badge = resolveProductCardBadge(product, summary, ribbonLabel)
  const thumbnail = resolveThumbnail(product)
  const [resolvedThumbnail, setResolvedThumbnail] = useState<string | null>(
    thumbnail
  )

  useEffect(() => {
    if (!handle) {
      return
    }

    const node = cardRef.current
    if (!node) {
      return
    }

    const prefetch = () => {
      if (shouldBlockPrefetch()) {
        return
      }
      prefetchProductDetail()
    }

    if (typeof window === "undefined") {
      return
    }

    if (!("IntersectionObserver" in window)) {
      prefetch()
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            prefetch()
            observer.disconnect()
          }
        })
      },
      { rootMargin: "240px" }
    )

    observer.observe(node)

    return () => {
      observer.disconnect()
    }
  }, [handle, prefetchProductDetail])

  useEffect(() => {
    if (!onMediaLoad) {
      return
    }

    onMediaLoad()
  }, [onMediaLoad])

  useEffect(() => {
    if (!onMediaLoad) {
      return
    }
    if (
      typeof window === "undefined" ||
      typeof ResizeObserver === "undefined"
    ) {
      return
    }

    const node = cardRef.current
    if (!node) {
      return
    }

    let animationFrame: number | null = null
    const observer = new ResizeObserver(() => {
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame)
      }

      animationFrame = requestAnimationFrame(() => {
        animationFrame = null
        onMediaLoad()
      })
    })

    observer.observe(node)

    return () => {
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame)
      }
      observer.disconnect()
    }
  }, [onMediaLoad])

  if (!handle.length) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[product-card] Skipping render for product without handle`,
        { id: summary.id }
      )
    }
    return null
  }
  const initialProduct = isStoreProduct(product) ? product : undefined
  const productType = isProductSearchHitSource(product)
    ? product.productType
    : isStoreProduct(product) &&
        typeof product.metadata?.product_type === "string"
      ? product.metadata.product_type
      : null
  const productHref = buildPublicProductPath({ handle, productType })
  const isBundle =
    resolvePublicProductRouteType({ handle, productType }) === "bundle"
  const bundleComponentCount = isProductSearchHitSource(product)
    ? product.bundleComponentCount
    : null
  const formatLabels = (() => {
    const labelsByKey = new Map<string, string>()

    const addLabel = (value: string | null | undefined) => {
      if (!value) {
        return
      }
      const trimmed = value.trim()
      if (!trimmed.length || trimmed.toLowerCase() === "default") {
        return
      }
      const key = trimmed.toLowerCase()
      if (!labelsByKey.has(key)) {
        labelsByKey.set(key, trimmed)
      }
    }

    if (isStoreProduct(product)) {
      product.variants?.forEach((variant) => {
        addLabel(variant?.title)
      })
      product.options?.forEach((option) => {
        if (option?.title?.toLowerCase() === "format") {
          option.values?.forEach((entry) => {
            addLabel(typeof entry?.value === "string" ? entry.value : null)
          })
        }
      })
      product.tags?.forEach((tag) => {
        addLabel(tag?.value)
      })
      const metadata = coerceMetadata(product.metadata)
      if (metadata) {
        addLabel(typeof metadata?.format === "string" ? metadata.format : null)
        addLabel(
          typeof metadata?.packaging === "string" ? metadata.packaging : null
        )
      }
    } else if (isProductSearchHitSource(product)) {
      product.variantTitles.forEach(addLabel)
      addLabel(product.format)
    } else {
      summary.formats.forEach(addLabel)
    }

    if (!labelsByKey.size) {
      summary.formats.forEach(addLabel)
    }

    if (!labelsByKey.size && summary.defaultVariant?.title) {
      addLabel(summary.defaultVariant.title)
    }

    return Array.from(labelsByKey.values())
  })()
  const normalizedFormatLabels = Array.from(
    new Map(
      formatLabels.map((label) => {
        const normalized = label.trim()
        const display = normalized.toLowerCase().includes("bundle")
          ? "Bundle"
          : normalized
        return [display.toLowerCase(), display]
      })
    ).values()
  )
  const visibleFormatLabels = normalizedFormatLabels.slice(0, 2)
  const hiddenFormatCount =
    normalizedFormatLabels.length - visibleFormatLabels.length

  const triggerPrefetch = () => {
    if (!handle || shouldBlockPrefetch()) {
      return
    }

    void router.prefetch(productHref, { kind: PrefetchKind.FULL })
    prefetchProductDetail()
  }

  const triggerQuickShopPrefetch = () => {
    triggerPrefetch()
    void loadProductQuickView()
  }

  const handleQuickShop = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (!canQuickShop) {
      return
    }
    prefetchProductDetail()
    setQuickShopOpen(true)
  }

  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
    if (
      isProductSearchHitSource(product) &&
      product.productType === "music-release" &&
      !summary.genres.length
    ) {
      console.warn("[ProductCard] missing genres", {
        handle: summary.handle,
        sourceType: isStoreProduct(product)
          ? "store"
          : isProductSearchHitSource(product)
            ? "search-hit"
            : "summary",
        rawGenres: isProductSearchHitSource(product)
          ? product.genres
          : undefined,
        rawMetalGenres: isProductSearchHitSource(product)
          ? product.metalGenres
          : undefined,
      })
    }
  }

  const handleMediaLoad = () => {
    onMediaLoad?.()
  }

  return (
    <>
      <div
        className="group relative h-full"
        ref={cardRef}
        onPointerEnter={triggerPrefetch}
        onFocusCapture={triggerPrefetch}
      >
        <SmartLink
          href={productHref}
          className="block h-full focus:outline-none"
          preloadOffset={280}
        >
          <Card className="relative flex h-full flex-col overflow-visible rounded-[1.75rem] border-2 border-border/60 bg-surface shadow-[0_22px_55px_-32px_rgba(0,0,0,0.75)] transition md:hover:-translate-y-1 md:hover:border-border/60 md:hover:shadow-[0_28px_70px_-40px_rgba(0,0,0,0.7)] focus-within:-translate-y-1 focus-within:border-border/60 focus-within:shadow-[0_28px_70px_-40px_rgba(0,0,0,0.7)]">
            {badge ? (
              <div className="product-card__corner">
                <span className="sr-only">Collection: </span>
                <span className="product-card__corner-ribbon">
                  {badge.toUpperCase()}
                </span>
              </div>
            ) : null}
            {isUnavailable ? (
              <div className="absolute left-4 top-4 z-40">
                <span className="inline-flex items-center rounded-full border border-border/70 bg-background/60 px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.14rem] text-muted-foreground shadow-[0_10px_24px_-18px_rgba(0,0,0,0.8)] sm:tracking-[0.24rem]">
                  Unavailable
                </span>
              </div>
            ) : stockBadge ? (
              <div className="absolute left-4 top-4 z-40">
                <span
                  className={cn(
                    "relative isolate inline-flex items-center rounded-full border px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.14rem] shadow-[0_10px_24px_-18px_rgba(0,0,0,0.8)] sm:tracking-[0.24rem]",
                    stockBadge.className
                  )}
                >
                  <span className="relative z-10">{stockBadge.label}</span>
                </span>
              </div>
            ) : null}
            {isBundle && bundleComponentCount && bundleComponentCount > 0 ? (
              <div className="absolute right-4 top-4 z-40">
                <span className="inline-flex items-center rounded-full border border-border/70 bg-background/90 px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.14rem] text-foreground shadow-[0_10px_24px_-18px_rgba(0,0,0,0.8)] sm:tracking-[0.22rem]">
                  {bundleComponentCount} items
                </span>
              </div>
            ) : null}
            <div className="flex h-full flex-col overflow-hidden rounded-[inherit] bg-surface">
              <div className="relative z-10 aspect-square overflow-hidden bg-card">
                {resolvedThumbnail ? (
                  <Image
                    src={resolvedThumbnail}
                    alt={summary.album ?? summary.title}
                    fill
                    sizes="(max-width: 639px) calc(100vw - 3rem), (max-width: 1023px) 45vw, (max-width: 1535px) 30vw, 320px"
                    className={cn(
                      "h-full w-full object-cover transition duration-300 md:group-hover:scale-[1.06] md:group-hover:rotate-[1.8deg] md:group-hover:brightness-[0.75] group-focus-within:scale-[1.06] group-focus-within:rotate-[1.8deg] group-focus-within:brightness-[0.75]",
                      (isSoldOut || isUnavailable) && "grayscale brightness-75"
                    )}
                    onLoad={handleMediaLoad}
                    onError={() => {
                      setResolvedThumbnail(null)
                      handleMediaLoad()
                    }}
                  />
                ) : (
                  <MediaPlaceholder label="No artwork" />
                )}
                <div className="pointer-events-none absolute inset-0 z-30 flex items-end justify-center p-6 opacity-0 transition-opacity duration-150 md:group-hover:opacity-100 group-focus-within:opacity-100">
                  <Button
                    type="button"
                    variant="filled"
                    className={cn(
                      "pointer-events-auto inline-flex items-center gap-2 rounded-full px-6 py-2 text-xs uppercase tracking-[0.3rem] shadow-glow focus-visible:ring-2 focus-visible:ring-destructive/70",
                      !canQuickShop && "cursor-not-allowed"
                    )}
                    onClick={handleQuickShop}
                    onFocus={triggerQuickShopPrefetch}
                    onPointerEnter={triggerQuickShopPrefetch}
                    aria-label={`Quick shop ${summary.album ?? summary.title}`}
                    disabled={!canQuickShop}
                  >
                    <ShoppingCart className="h-4 w-4" aria-hidden="true" />
                    <span>
                      {isUnavailable
                        ? "Unavailable"
                        : isSoldOut
                          ? "Sold out"
                          : "Quick shop"}
                    </span>
                  </Button>
                </div>
              </div>
              <div className="flex h-[13.5rem] flex-col justify-between px-4 py-4 sm:h-[14rem] sm:px-5 sm:py-6">
                <div className="min-w-0 space-y-2">
                  <p className="line-clamp-2 min-h-8 break-words text-xs uppercase leading-4 tracking-[0.16rem] text-muted-foreground sm:tracking-[0.3rem]">
                    {summary.artist}
                  </p>
                  <h3
                    className="truncate font-bebas text-xl uppercase tracking-[0.14rem] text-foreground sm:text-2xl sm:tracking-[0.3rem]"
                    title={summary.album ?? summary.title}
                  >
                    {summary.album ?? summary.title}
                  </h3>
                  <p className="min-h-5 text-sm font-semibold text-foreground">
                    {cardPrice?.label ?? null}
                  </p>
                </div>
                <div className="mt-4 flex min-h-7 flex-wrap content-start gap-2 overflow-hidden">
                  {visibleFormatLabels.map((label) => (
                    <Badge
                      key={`${summary.id}-${label}`}
                      variant="outline"
                      className="flex min-h-[1.75rem] items-center justify-center rounded-full border-border/40 bg-background px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.12rem] text-foreground sm:tracking-[0.22rem]"
                    >
                      <span className="text-center leading-none">
                        {label.toUpperCase()}
                      </span>
                    </Badge>
                  ))}
                  {hiddenFormatCount > 0 ? (
                    <Badge
                      variant="outline"
                      className="flex min-h-[1.75rem] items-center justify-center rounded-full border-border/40 bg-background px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.12rem] text-foreground sm:tracking-[0.22rem]"
                      aria-label={`${hiddenFormatCount} more formats`}
                    >
                      +{hiddenFormatCount}
                    </Badge>
                  ) : null}
                </div>
              </div>
            </div>
            {isSoldOut || isUnavailable ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-30 rounded-[inherit] bg-black/45"
              />
            ) : null}
          </Card>
        </SmartLink>
      </div>

      {quickShopOpen ? (
        <ProductQuickView
          handle={handle}
          open
          onOpenChange={setQuickShopOpen}
          {...(initialProduct ? { initialProduct } : {})}
        />
      ) : null}
    </>
  )
}

export default ProductCard
