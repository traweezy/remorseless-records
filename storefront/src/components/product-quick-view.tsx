"use client"

import { useMemo } from "react"
import { usePathname } from "next/navigation"

import type { HttpTypes } from "@medusajs/types"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import ProductVariantSelector from "@/components/product-variant-selector"
import { deriveVariantOptions } from "@/lib/products/transformers"
import { useProductDetailQuery } from "@/lib/query/products"

type StoreProduct = HttpTypes.StoreProduct

type ProductQuickViewProps = {
  handle: string
  initialProduct?: StoreProduct
  open: boolean
  onOpenChange: (open: boolean) => void
}

const heroImageFor = (product: StoreProduct | null): string | null => {
  if (!product) {
    return null
  }

  if (product.thumbnail) {
    return product.thumbnail
  }

  const image = product.images?.find((item) => item?.url)
  return image?.url ?? null
}

export const ProductQuickView = ({ handle, initialProduct, open, onOpenChange }: ProductQuickViewProps) => {
  const pathname = usePathname()

  const {
    data: detail,
    isFetching,
    isError,
    refetch,
  } = useProductDetailQuery(handle, {
    enabled: open && Boolean(handle),
    ...(initialProduct ? { initialData: initialProduct } : {}),
    staleTime: 5 * 60_000,
  })

  const activeProduct = detail ?? initialProduct ?? null
  const variants = useMemo(
    () => deriveVariantOptions(activeProduct?.variants),
    [activeProduct?.variants]
  )

  const description =
    activeProduct?.description ??
    activeProduct?.subtitle ??
    "Full release notes drop soon. Spin now before it sells out."

  const heroImage = heroImageFor(activeProduct)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[min(92vw,720px)] overflow-hidden bg-background/95">
        <div className="grid gap-6 p-6 sm:grid-cols-[1.1fr_1fr] sm:gap-10 sm:p-10">
          <div className="space-y-6">
            <DialogHeader className="space-y-3 text-left">
              <DialogTitle className="font-bebas text-3xl uppercase tracking-[0.3rem]">
                {activeProduct?.title ?? "Loading release"}
              </DialogTitle>
              {activeProduct?.subtitle ? (
                <DialogDescription className="text-xs uppercase tracking-[0.3rem] text-muted-foreground">
                  {activeProduct.subtitle}
                </DialogDescription>
              ) : null}
            </DialogHeader>
            <div className="overflow-hidden rounded-2xl border border-border/60 bg-background/80">
              {heroImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={heroImage}
                  alt={activeProduct?.title ?? "Release artwork"}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex aspect-square items-center justify-center text-xs uppercase tracking-[0.3rem] text-muted-foreground">
                  No artwork
                </div>
              )}
            </div>
            <p className="hidden text-xs leading-relaxed text-muted-foreground sm:block">
              {description}
            </p>
          </div>

          <div className="space-y-6">
            {isFetching && !detail && !initialProduct ? (
              <div className="space-y-4">
                <div className="h-8 rounded-full skeleton" />
                <div className="h-32 rounded-2xl skeleton" />
                <div className="h-11 rounded-full skeleton" />
              </div>
            ) : isError ? (
              <div className="space-y-4 rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive-foreground">
                <p>Unable to load product details. Please try again.</p>
                <button
                  type="button"
                  onClick={() => {
                    void refetch()
                  }}
                  className="rounded-full border border-destructive px-4 py-1 text-xs uppercase tracking-[0.3rem] text-destructive transition hover:bg-destructive hover:text-destructive-foreground"
                >
                  Retry
                </button>
              </div>
            ) : (
              <ProductVariantSelector
                variants={variants}
                productTitle={activeProduct?.title ?? "Release"}
                redirectPath={pathname ?? "/products"}
              />
            )}
            <p className="text-xs leading-relaxed text-muted-foreground sm:hidden">
              {description}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default ProductQuickView
