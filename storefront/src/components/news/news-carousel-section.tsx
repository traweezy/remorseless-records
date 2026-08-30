"use client"

import { useCallback, useMemo, type ReactElement } from "react"
import { Splide, SplideSlide } from "@splidejs/react-splide"
import { AutoScroll } from "@splidejs/splide-extension-auto-scroll"

import NewsCarouselCard from "@/components/news/news-carousel-card"
import { SectionHeading } from "@/components/ui/section-heading"
import { useCarouselAutoScroll } from "@/hooks/use-carousel-auto-scroll"
import type { NewsEntry } from "@/lib/news/contract"

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
  const {
    destroy: destroyAutoScroll,
    go,
    mount: mountAutoScroll,
  } = useCarouselAutoScroll()

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
              ...(slides.length > 1
                ? {
                    autoScroll: {
                      speed: 0.45,
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
