"use client"

import { useCallback, useEffect, useMemo, useTransition, useState } from "react"
import { usePathname } from "next/navigation"

import type { HttpTypes } from "@medusajs/types"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import ProductVariantSelector from "@/components/product-variant-selector"
import { deriveVariantOptions } from "@/lib/products/transformers"

type StoreProduct = HttpTypes.StoreProduct

type ProductQuickViewProps = {
  product: StoreProduct
  open: boolean
  onOpenChange: (open: boolean) => void
}

type ProductDetailResponse = {
  product: StoreProduct
}

const heroImageFor = (product: StoreProduct): string | null => {
  if (product.thumbnail) {
    return product.thumbnail
  }

  const image = product.images?.find((item) => item?.url)
  return image?.url ?? null
}

export const ProductQuickView = ({
  product,
  open,
  onOpenChange,
}: ProductQuickViewProps) => {
  const pathname = usePathname()
  const [loading, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<StoreProduct | null>(null)

  const activeProduct = detail ?? product
  const variants = useMemo(
    () => deriveVariantOptions(activeProduct.variants),
    [activeProduct.variants]
  )

  const description =
    activeProduct.description ??
    activeProduct.subtitle ??
    "Full release notes drop soon. Spin now before it sells out."

  const heroImage = heroImageFor(activeProduct)

  const fetchProduct = useCallback(() => {
    if (!product.handle) {
      setError("Product handle missing.")
      return
    }

    startTransition(async () => {
      try {
        setError(null)
        const response = await fetch(`/api/products/${product.handle}`, {
          cache: "no-store",
        })

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`)
        }

        const payload = (await response.json()) as ProductDetailResponse
        setDetail(payload.product)
      } catch (cause) {
        console.error("Quick view fetch failed", cause)
        setError("Unable to load product details. Please try again.")
      }
    })
  }, [product.handle])

  useEffect(() => {
    if (!open) {
      return
    }

    if (!detail && !loading) {
      void fetchProduct()
    }
  }, [open, detail, loading, fetchProduct])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[min(92vw,720px)] overflow-hidden bg-background/95">
        <div className="grid gap-6 p-6 sm:grid-cols-[1.1fr_1fr] sm:gap-10 sm:p-10">
          <div className="space-y-6">
            <DialogHeader className="space-y-3 text-left">
              <DialogTitle className="font-bebas text-3xl uppercase tracking-[0.3rem]">
                {activeProduct.title ?? "Release"}
              </DialogTitle>
              {activeProduct.subtitle ? (
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
                  alt={activeProduct.title ?? "Release artwork"}
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
            {loading && !detail ? (
              <div className="space-y-4">
                <div className="h-8 rounded-full skeleton" />
                <div className="h-32 rounded-2xl skeleton" />
                <div className="h-11 rounded-full skeleton" />
              </div>
            ) : error ? (
              <div className="space-y-4 rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive-foreground">
                <p>{error}</p>
                <button
                  type="button"
                  onClick={() => {
                    setError(null)
                    void fetchProduct()
                  }}
                  className="rounded-full border border-destructive px-4 py-1 text-xs uppercase tracking-[0.3rem] text-destructive transition hover:bg-destructive hover:text-destructive-foreground"
                >
                  Retry
                </button>
              </div>
            ) : (
              <ProductVariantSelector
                variants={variants}
                productTitle={activeProduct.title ?? "Release"}
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
