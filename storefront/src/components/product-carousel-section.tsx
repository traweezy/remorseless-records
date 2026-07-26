"use client"

import React, { useCallback, useMemo, type ReactElement } from "react"
import type { HttpTypes } from "@medusajs/types"
import { Splide, SplideSlide } from "@splidejs/react-splide"
import { AutoScroll } from "@splidejs/splide-extension-auto-scroll"

import ProductCard from "@/components/product-card"
import { SectionHeading } from "@/components/ui/section-heading"
import { useCarouselAutoScroll } from "@/hooks/use-carousel-auto-scroll"

import "@splidejs/react-splide/css"

type StoreProduct = HttpTypes.StoreProduct

type SectionHeading = {
  leading: string
  highlight: string
}

type ProductCarouselSectionProps = {
  heading: SectionHeading
  description: string
  products: StoreProduct[]
  ribbonLabel?: string | null
}

const perPageByBreakpoint = {
  default: 6,
  "1800": 5,
  "1440": 4,
  "1024": 3,
  "768": 2,
  "640": 1,
} as const

export const ProductCarouselSection = ({
  heading,
  description,
  products,
  ribbonLabel,
}: ProductCarouselSectionProps): ReactElement | null => {
  const {
    destroy: destroyAutoScroll,
    go,
    mount: mountAutoScroll,
  } = useCarouselAutoScroll()
  const slides = useMemo<StoreProduct[]>(
    () =>
      products.filter(
        (product) =>
          typeof product.handle === "string" && product.handle.trim().length > 0
      ),
    [products]
  )

  const filledSlides = useMemo<StoreProduct[]>(() => {
    if (!slides.length) {
      return []
    }
    const target = perPageByBreakpoint.default
    if (slides.length >= target) {
      return slides
    }
    const extended: StoreProduct[] = []
    for (let index = 0; index < target; index += 1) {
      const next = slides[index % slides.length]
      if (next) {
        extended.push(next)
      }
    }
    return extended
  }, [slides])

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      const { deltaX, deltaY } = event
      const dominantHorizontal =
        Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 4
      if (!dominantHorizontal) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      go(deltaX > 0 ? "+1" : "-1")
    },
    [go]
  )

  if (!slides.length) {
    return null
  }

  return (
    <section className="space-y-10">
      <SectionHeading
        leading={heading.leading}
        highlight={heading.highlight}
        description={description}
      />

      <div className="product-carousel">
        <div className="product-carousel__container" onWheel={handleWheel}>
          <Splide
            className="product-carousel__splide"
            aria-label={`${heading.leading} ${heading.highlight}`}
            options={{
              type: "loop",
              pagination: false,
              drag: true,
              perPage: perPageByBreakpoint.default,
              perMove: 1,
              speed: 420,
              easing: "cubic-bezier(0.33, 1, 0.68, 1)",
              gap: "clamp(12px, 1.5vw, 20px)",
              pauseOnHover: true,
              pauseOnFocus: true,
              wheel: false,
              arrows: slides.length > 1,
              trimSpace: false,
              classes: {
                arrows: "product-carousel__arrows",
                arrow: "product-carousel__arrow",
                prev: "product-carousel__arrow product-carousel__arrow--left",
                next: "product-carousel__arrow product-carousel__arrow--right",
              },
              breakpoints: {
                1800: { perPage: perPageByBreakpoint["1800"] },
                1440: { perPage: perPageByBreakpoint["1440"] },
                1024: { perPage: perPageByBreakpoint["1024"] },
                768: { perPage: perPageByBreakpoint["768"] },
                640: { perPage: perPageByBreakpoint["640"] },
              },
              ...(slides.length > 1
                ? {
                    autoScroll: {
                      speed: 0.6,
                      autoStart: false,
                      pauseOnHover: true,
                      pauseOnFocus: true,
                    },
                  }
                : {}),
            }}
            extensions={slides.length > 1 ? { AutoScroll } : {}}
            hasTrack
            onMounted={mountAutoScroll}
            onDestroy={destroyAutoScroll}
          >
            {filledSlides.map((product, index) => (
              <SplideSlide
                key={`${product.id ?? product.handle ?? "product"}-${index}`}
                className="product-carousel__slide"
              >
                <div className="product-carousel__card">
                  <ProductCard
                    product={product}
                    {...(ribbonLabel !== undefined ? { ribbonLabel } : {})}
                  />
                </div>
              </SplideSlide>
            ))}
          </Splide>
        </div>
      </div>
    </section>
  )
}

export default ProductCarouselSection
