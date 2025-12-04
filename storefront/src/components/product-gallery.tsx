"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import { AnimatePresence, motion } from "framer-motion"

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
  const sanitized = useMemo(
    () =>
      images.filter((image) => typeof image?.url === "string" && image.url.trim().length > 0),
    [images]
  )
  const [activeIndex, setActiveIndex] = useState(0)

  if (!sanitized.length) {
    return (
      <div className="aspect-[4/5] rounded-3xl border border-border/60 bg-background/80" />
    )
  }

  const active = sanitized[Math.min(activeIndex, sanitized.length - 1)]

  return (
    <div className="space-y-4 overflow-hidden">
      <div className="relative aspect-[4/5] overflow-hidden rounded-3xl border border-border/70 bg-background/80 shadow-[0_32px_60px_-40px_rgba(0,0,0,0.7)]">
        <AnimatePresence mode="wait">
          <motion.div
            key={active?.id ?? active?.url}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0"
          >
            <Image
              src={active?.url ?? "/remorseless-hero-logo.png"}
              alt={active?.alt ?? title}
              fill
              sizes="(min-width: 1024px) 520px, 90vw"
              className="object-cover"
              priority
            />
          </motion.div>
        </AnimatePresence>
      </div>
      {sanitized.length > 1 ? (
        <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-none">
          {sanitized.map((image, index) => {
            const isActive = index === activeIndex
            return (
              <button
                key={image.id ?? image.url ?? `thumb-${index}`}
                type="button"
                onClick={() => setActiveIndex(index)}
                className={`relative aspect-square w-24 flex-shrink-0 overflow-hidden rounded-xl border ${
                  isActive ? "border-destructive" : "border-border/50"
                } bg-background/70 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive`}
                aria-label={`View image ${index + 1} of ${sanitized.length}`}
              >
                <Image
                  src={image.url}
                  alt={image.alt ?? title}
                  fill
                  sizes="96px"
                  className="object-cover"
                />
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export default ProductGallery
