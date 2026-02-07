"use client"

import { useMemo, useRef, type ReactElement } from "react"
type SplideNav = { go: (destination: string | number) => void }
import { Splide, SplideSlide } from "@splidejs/react-splide"
import { AutoScroll } from "@splidejs/splide-extension-auto-scroll"

import NewsCarouselCard from "@/components/news/news-carousel-card"
import type { NewsEntry } from "@/lib/data/news"

import "@splidejs/react-splide/css"

type SectionHeading = {
  leading: string
  highlight: string
}

type NewsCarouselSectionProps = {
  heading: SectionHeading
  description: string
  entries: NewsEntry[]
}

const perPageByBreakpoint = {
  default: 3,
  "1440": 3,
  "1200": 2,
  "768": 1,
} as const

export const NewsCarouselSection = ({
  heading,
  description,
  entries,
}: NewsCarouselSectionProps): ReactElement | null => {
  const splideRef = useRef<SplideNav | null>(null)

  const slides = useMemo<NewsEntry[]>(
    () => entries.filter((entry) => entry.status === "published"),
    [entries]
  )

  const filledSlides = useMemo<NewsEntry[]>(() => {
    if (!slides.length) {
      return []
    }
    const target = perPageByBreakpoint.default
    if (slides.length >= target) {
      return slides
    }
    const extended: NewsEntry[] = []
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

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const { deltaX, deltaY } = event
    const dominantHorizontal =
      Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 4
    if (!dominantHorizontal || !splideRef.current) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    splideRef.current.go(deltaX > 0 ? "+1" : "-1")
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
              gap: "clamp(16px, 2vw, 24px)",
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
                1440: { perPage: perPageByBreakpoint["1440"] },
                1200: { perPage: perPageByBreakpoint["1200"] },
                768: { perPage: perPageByBreakpoint["768"] },
              },
              autoScroll: {
                speed: 0.45,
                autoStart: true,
                pauseOnHover: true,
                pauseOnFocus: true,
              },
            }}
            extensions={{ AutoScroll }}
            hasTrack
            onMounted={(splide: unknown) => {
              const candidate = splide as {
                go?: (destination: string | number) => void
              }
              splideRef.current = candidate?.go
                ? { go: candidate.go.bind(candidate) }
                : null
            }}
            onDestroy={() => {
              splideRef.current = null
            }}
          >
            {filledSlides.map((entry, index) => (
              <SplideSlide
                key={`${entry.id}-${index}`}
                className="product-carousel__slide"
              >
                <div className="product-carousel__card">
                  <NewsCarouselCard entry={entry} />
                </div>
              </SplideSlide>
            ))}
          </Splide>
        </div>
      </div>
    </section>
  )
}

export default NewsCarouselSection
