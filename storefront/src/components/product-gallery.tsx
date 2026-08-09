"use client"

import { useCallback, useMemo, useState } from "react"
import Image from "next/image"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { MediaPlaceholder } from "@/components/ui/media-placeholder"

type GalleryImage = {
  id?: string | null
  url: string
  alt: string
}

type ProductGalleryProps = {
  images: GalleryImage[]
  title: string
}

const ProductGallery = ({ images, title }: ProductGalleryProps) => {
  const prefersReducedMotion = useReducedMotion()
  const [failedUrls, setFailedUrls] = useState<Set<string>>(new Set())
  const sanitized = useMemo(
    () =>
      images.filter(
        (image) =>
          typeof image?.url === "string" &&
          image.url.trim().length > 0 &&
          !failedUrls.has(image.url)
      ),
    [failedUrls, images]
  )
  const [activeIndex, setActiveIndex] = useState(0)
  const resolvedActiveIndex = Math.min(
    activeIndex,
    Math.max(0, sanitized.length - 1)
  )

  const showPrevious = useCallback(() => {
    setActiveIndex((current) => Math.max(0, current - 1))
  }, [])

  const showNext = useCallback(() => {
    setActiveIndex((current) =>
      Math.min(Math.max(0, sanitized.length - 1), current + 1)
    )
  }, [sanitized.length])

  if (!sanitized.length) {
    return (
      <MediaPlaceholder
        label="Artwork unavailable"
        showIcon
        className="mx-auto aspect-square w-full max-w-[20rem] rounded-3xl border border-border/60 bg-black sm:max-w-[32rem] lg:max-w-none"
      />
    )
  }

  const active = sanitized[resolvedActiveIndex]
  const markFailed = (url?: string | null) => {
    if (!url) return
    setFailedUrls((prev) => {
      if (prev.has(url)) {
        return prev
      }
      const next = new Set(prev)
      next.add(url)
      return next
    })
  }

  return (
    <div className="mx-auto min-w-0 w-full max-w-[20rem] space-y-4 overflow-hidden sm:max-w-[32rem] lg:max-w-none">
      <div className="relative aspect-square overflow-hidden rounded-3xl border border-border/70 bg-black shadow-[0_32px_60px_-40px_rgba(0,0,0,0.7)]">
        <AnimatePresence mode="wait">
          <motion.div
            key={active?.id ?? active?.url}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
            className="absolute inset-0"
          >
            <Image
              src={active?.url ?? "/remorseless-hero-logo.png"}
              alt={active?.alt ?? title}
              fill
              sizes="(max-width: 639px) 100vw, (max-width: 1023px) 92vw, 520px"
              className="object-contain"
              priority
              onError={() => markFailed(active?.url)}
            />
          </motion.div>
        </AnimatePresence>
        {sanitized.length > 1 ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="absolute left-3 top-1/2 z-10 -translate-y-1/2 border-white/50 bg-black/75 text-white shadow-lg backdrop-blur-sm hover:bg-black/90 hover:text-white disabled:opacity-35"
              onClick={showPrevious}
              disabled={resolvedActiveIndex === 0}
              aria-label="Previous image"
            >
              <ChevronLeft className="size-5" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="absolute right-3 top-1/2 z-10 -translate-y-1/2 border-white/50 bg-black/75 text-white shadow-lg backdrop-blur-sm hover:bg-black/90 hover:text-white disabled:opacity-35"
              onClick={showNext}
              disabled={resolvedActiveIndex === sanitized.length - 1}
              aria-label="Next image"
            >
              <ChevronRight className="size-5" aria-hidden="true" />
            </Button>
          </>
        ) : null}
      </div>
      {sanitized.length > 1 ? (
        <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-none touch-pan-x">
          {sanitized.map((image, index) => {
            const isActive = index === resolvedActiveIndex
            return (
              <Button
                key={image.id ?? image.url ?? `thumb-${index}`}
                type="button"
                variant="unstyled"
                size="auto"
                onClick={() => setActiveIndex(index)}
                className={`relative aspect-square w-20 flex-shrink-0 overflow-hidden rounded-xl border sm:w-24 ${
                  isActive ? "border-destructive" : "border-border/50"
                } bg-background/70 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive`}
                aria-label={`View image ${index + 1} of ${sanitized.length}`}
              >
                <Image
                  src={image.url}
                  alt={image.alt ?? title}
                  fill
                  sizes="96px"
                  className="object-contain"
                  onError={() => markFailed(image.url)}
                />
              </Button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export default ProductGallery
