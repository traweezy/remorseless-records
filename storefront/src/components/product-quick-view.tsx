"use client"

import { useMemo } from "react"

import { motion, useReducedMotion, type Transition } from "framer-motion"
import type { HttpTypes } from "@medusajs/types"

import ProductVariantSelector from "@/components/product-variant-selector"
import { Alert } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import Drawer, {
  DrawerCloseButton,
  DrawerEyebrow,
  DrawerHeader,
  DrawerHeading,
  DrawerTitle,
} from "@/components/ui/drawer"
import { MediaPlaceholder } from "@/components/ui/media-placeholder"
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

export const ProductQuickView = ({
  handle,
  initialProduct,
  open,
  onOpenChange,
}: ProductQuickViewProps) => {
  const prefersReducedMotion = useReducedMotion()

  const {
    data: detail,
    isFetching,
    isError,
    refetch,
  } = useProductDetailQuery(handle, {
    enabled: open && Boolean(handle),
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
  const easeOutExpo = [0.4, 0, 0.2, 1] as const

  const skeletonTransition: Transition = prefersReducedMotion
    ? { duration: 0.2, ease: easeOutExpo }
    : { type: "spring", stiffness: 260, damping: 26 }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} ariaLabel="Quick shop">
      <div className="flex h-full flex-col overflow-hidden">
        <DrawerHeader>
          <DrawerHeading>
            <DrawerEyebrow>Quick shop</DrawerEyebrow>
            <DrawerTitle>
              {activeProduct?.title ?? "Loading release"}
            </DrawerTitle>
            {activeProduct?.subtitle ? (
              <p className="text-[0.65rem] uppercase tracking-[0.35rem] text-muted-foreground">
                {activeProduct.subtitle}
              </p>
            ) : null}
          </DrawerHeading>
          <DrawerCloseButton label="Close quick shop" />
        </DrawerHeader>

        <div className="relative aspect-[4/5] w-full overflow-hidden border-b border-border/60 bg-background/80">
          {heroImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={heroImage}
              alt={activeProduct?.title ?? "Release artwork"}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <MediaPlaceholder label="No artwork" />
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {isFetching && !detail && !initialProduct ? (
            <motion.div
              className="space-y-5"
              initial={{ opacity: prefersReducedMotion ? 1 : 0 }}
              animate={{ opacity: 1 }}
              transition={skeletonTransition}
            >
              <div className="h-8 rounded-full skeleton" />
              <div className="h-36 rounded-2xl skeleton" />
              <div className="h-12 rounded-full skeleton" />
            </motion.div>
          ) : isError ? (
            <Alert variant="destructive" className="space-y-4 p-6">
              <p>Unable to load product details. Please try again.</p>
              <Button
                type="button"
                variant="outlined"
                size="auto"
                onClick={() => {
                  void refetch()
                }}
                className="rounded-full border border-destructive px-4 py-2 text-xs uppercase tracking-[0.3rem] text-destructive transition hover:bg-destructive hover:text-destructive-foreground"
              >
                Retry
              </Button>
            </Alert>
          ) : (
            <div className="space-y-6">
              <ProductVariantSelector
                variants={variants}
                productTitle={activeProduct?.title ?? "Release"}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                {description}
              </p>
            </div>
          )}
        </div>
      </div>
    </Drawer>
  )
}

export default ProductQuickView
