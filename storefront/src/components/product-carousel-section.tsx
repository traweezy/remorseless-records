"use client"

import React, { useEffect, useMemo, useRef, type ReactElement } from "react"
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
  const slides = useMemo(
    () => products.filter((product) => typeof product.handle === "string" && product.handle.trim().length > 0),
    [products]
  )

  const sectionRef = useRef<HTMLDivElement | null>(null)

  if (!slides.length) {
    return null
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    const section = sectionRef.current
    if (!section) {
      return
    }

    const selectCards = () => Array.from(section.querySelectorAll<HTMLDivElement>(".product-carousel__card"))
    let cards = selectCards()
    if (!cards.length) {
      return
    }

    const applyHeight = () => {
      cards = selectCards()
      if (!cards.length) {
        return
      }

      cards.forEach((card) => {
        card.style.height = ""
      })

      const maxHeight = Math.max(...cards.map((card) => card.getBoundingClientRect().height))

      cards.forEach((card) => {
        card.style.height = `${maxHeight}px`
      })
    }

    applyHeight()

    const resizeObserverAvailable = typeof ResizeObserver === "function"
    const observer = resizeObserverAvailable
      ? new ResizeObserver(() => {
          applyHeight()
        })
      : null

    if (observer) {
      cards.forEach((card) => observer.observe(card))
    }

    window.addEventListener("resize", applyHeight)

    return () => {
      window.removeEventListener("resize", applyHeight)
      observer?.disconnect()
      cards.forEach((card) => {
        card.style.removeProperty("height")
      })
    }
  }, [slides.length])

  return (
    <section ref={sectionRef} className="space-y-10">
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
            {slides.map((product) => (
              <SplideSlide key={product.id} className="product-carousel__slide">
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
