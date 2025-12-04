"use client"

import { useMemo } from "react"
import { usePathname } from "next/navigation"

import * as SheetPrimitive from "@radix-ui/react-dialog"
import { VisuallyHidden } from "@radix-ui/react-visually-hidden"
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Transition,
} from "framer-motion"
import { X } from "lucide-react"
import type { HttpTypes } from "@medusajs/types"

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
  const prefersReducedMotion = useReducedMotion()

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

  const easeOutExpo = [0.4, 0, 0.2, 1] as const
  const easeInSharp = [0.4, 0, 1, 1] as const

  const overlayTransition: Transition = prefersReducedMotion
    ? { duration: 0.18, ease: easeOutExpo }
    : { duration: 0.3, ease: easeOutExpo }

  const panelTransition: Transition = prefersReducedMotion
    ? { duration: 0.24, ease: easeOutExpo }
    : { type: "spring", damping: 30, stiffness: 300, mass: 0.8 }

  const panelExitTransition: Transition = prefersReducedMotion
    ? { duration: 0.18, ease: easeInSharp }
    : { duration: 0.26, ease: easeInSharp }

  return (
    <SheetPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence initial={false}>
        {open ? (
          <SheetPrimitive.Portal forceMount>
            <SheetPrimitive.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={overlayTransition}
              />
            </SheetPrimitive.Overlay>

            <SheetPrimitive.Content asChild forceMount>
              <motion.aside
                className="fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-[448px] flex-col border-l border-border/60 bg-background/95 shadow-glow sm:rounded-l-2xl"
                initial="closed"
                animate={open ? "open" : "closed"}
                exit="closed"
                variants={{
                  open: { x: 0, opacity: 1, transition: panelTransition },
                  closed: {
                    x: prefersReducedMotion ? 0 : "100%",
                    opacity: prefersReducedMotion ? 0 : 1,
                    transition: panelExitTransition,
                  },
                }}
              >
                <div className="flex flex-1 flex-col overflow-hidden">
                  <header className="flex items-start justify-between border-b border-border/60 px-6 py-4">
                    <VisuallyHidden>
                      <SheetPrimitive.Title>Quick shop</SheetPrimitive.Title>
                    </VisuallyHidden>
                    <div className="space-y-1 text-left">
                      <p className="text-xs font-headline uppercase tracking-[0.35rem] text-muted-foreground">
                        Quick shop
                      </p>
                      <p className="font-bebas text-3xl uppercase tracking-[0.35rem] text-foreground">
                        {activeProduct?.title ?? "Loading release"}
                      </p>
                      {activeProduct?.subtitle ? (
                        <p className="text-[0.65rem] uppercase tracking-[0.35rem] text-muted-foreground">
                          {activeProduct.subtitle}
                        </p>
                      ) : null}
                    </div>
                    <SheetPrimitive.Close asChild>
                      <button
                        type="button"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/70 text-muted-foreground transition hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                        aria-label="Close quick shop"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </SheetPrimitive.Close>
                  </header>

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
                      <div className="flex h-full items-center justify-center text-xs uppercase tracking-[0.3rem] text-muted-foreground">
                        No artwork
                      </div>
                    )}
                  </div>

                  <div className="flex-1 overflow-y-auto px-6 py-6">
                    {isFetching && !detail && !initialProduct ? (
                      <div className="space-y-5">
                        <div className="h-8 rounded-full skeleton" />
                        <div className="h-36 rounded-2xl skeleton" />
                        <div className="h-12 rounded-full skeleton" />
                      </div>
                    ) : isError ? (
                      <div className="space-y-4 rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive-foreground">
                        <p>Unable to load product details. Please try again.</p>
                        <button
                          type="button"
                          onClick={() => {
                            void refetch()
                          }}
                          className="rounded-full border border-destructive px-4 py-2 text-xs uppercase tracking-[0.3rem] text-destructive transition hover:bg-destructive hover:text-destructive-foreground"
                        >
                          Retry
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-6">
                        <ProductVariantSelector
                          variants={variants}
                          productTitle={activeProduct?.title ?? "Release"}
                          redirectPath={pathname ?? "/products"}
                        />
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {description}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </motion.aside>
            </SheetPrimitive.Content>
          </SheetPrimitive.Portal>
        ) : null}
      </AnimatePresence>
    </SheetPrimitive.Root>
  )
}

export default ProductQuickView
