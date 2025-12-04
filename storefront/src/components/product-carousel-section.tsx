"use client"

import React, { useMemo, type ReactElement } from "react"
import type { HttpTypes } from "@medusajs/types"
import { Splide, SplideSlide } from "@splidejs/react-splide"
import { AutoScroll } from "@splidejs/splide-extension-auto-scroll"

import ProductCard from "@/components/product-card"

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
}: ProductCarouselSectionProps): ReactElement | null => {
  const slides = useMemo<StoreProduct[]>(
    () => products.filter((product) => typeof product.handle === "string" && product.handle.trim().length > 0),
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

  if (!slides.length) {
    return null
  }

  return (
    <section className="space-y-10">
      <header className="text-center">
        <h2 className="font-bebas text-5xl uppercase tracking-[0.55rem] text-foreground md:text-6xl">
          {heading.leading}{" "}
          <span className="text-destructive">{heading.highlight}</span>
        </h2>
        <p className="mt-3 text-base text-muted-foreground md:text-lg">
          {description}
        </p>
      </header>

      <div className="product-carousel">
        <div className="product-carousel__container">
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
              autoScroll: {
                speed: 0.6,
                autoStart: true,
                pauseOnHover: true,
                pauseOnFocus: true,
              },
            }}
            extensions={{ AutoScroll }}
            hasTrack
          >
            {filledSlides.map((product, index) => (
              <SplideSlide
                key={`${product.id ?? product.handle ?? "product"}-${index}`}
                className="product-carousel__slide"
              >
                <div className="product-carousel__card">
                  <ProductCard product={product} />
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
