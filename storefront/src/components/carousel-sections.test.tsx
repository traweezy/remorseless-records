import type { ReactNode } from "react"
import type { HttpTypes } from "@medusajs/types"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { NewsEntry } from "@/lib/data/news"

const carouselCapture = vi.hoisted(() => ({
  options: [] as Array<Record<string, unknown>>,
  extensions: [] as Array<Record<string, unknown>>,
}))

vi.mock("@splidejs/react-splide", () => ({
  Splide: ({
    children,
    extensions,
    options,
  }: {
    children: ReactNode
    extensions: Record<string, unknown>
    options: Record<string, unknown>
  }) => {
    carouselCapture.options.push(options)
    carouselCapture.extensions.push(extensions)
    return <div data-testid="splide">{children}</div>
  },
  SplideSlide: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock("@splidejs/splide-extension-auto-scroll", () => ({
  AutoScroll: vi.fn(),
}))
vi.mock("@/components/product-card", () => ({
  default: ({ ribbonLabel }: { ribbonLabel?: string | null }) => (
    <div data-testid="product-card" data-ribbon={ribbonLabel ?? ""} />
  ),
}))
vi.mock("@/components/news/news-carousel-card", () => ({
  default: () => <div data-testid="news-card" />,
}))
vi.mock("@/components/ui/section-heading", () => ({
  SectionHeading: () => <h2>Carousel heading</h2>,
}))

import NewsCarouselSection from "@/components/news/news-carousel-section"
import ProductCarouselSection from "@/components/product-carousel-section"

const products = [
  { id: "prod_1", handle: "release-one" },
  { id: "prod_2", handle: "release-two" },
] as HttpTypes.StoreProduct[]

const entries = [
  { id: "news_1", status: "published" },
  { id: "news_2", status: "published" },
] as NewsEntry[]

describe("homepage carousel sections", () => {
  beforeEach(() => {
    carouselCapture.options.length = 0
    carouselCapture.extensions.length = 0
  })

  it("restores continuous product motion and passes the shelf ribbon", () => {
    render(
      <ProductCarouselSection
        heading={{ leading: "Featured", highlight: "Picks" }}
        description="Featured products"
        products={products}
        ribbonLabel="Featured"
      />
    )

    expect(carouselCapture.options[0]?.autoScroll).toEqual({
      speed: 0.6,
      autoStart: false,
      pauseOnHover: true,
      pauseOnFocus: true,
    })
    expect(carouselCapture.extensions[0]).toHaveProperty("AutoScroll")
    expect(
      screen.getByRole("button", { name: "Play Featured Picks carousel" })
    ).toBeInTheDocument()
    screen.getAllByTestId("product-card").forEach((card) => {
      expect(card).toHaveAttribute("data-ribbon", "Featured")
    })
  })

  it("restores continuous news motion", () => {
    render(
      <NewsCarouselSection
        heading={{ leading: "Latest", highlight: "News" }}
        description="Latest news"
        entries={entries}
      />
    )

    expect(carouselCapture.options[0]?.autoScroll).toEqual({
      speed: 0.45,
      autoStart: false,
      pauseOnHover: true,
      pauseOnFocus: true,
    })
    expect(carouselCapture.extensions[0]).toHaveProperty("AutoScroll")
    expect(
      screen.getByRole("button", { name: "Play Latest News carousel" })
    ).toBeInTheDocument()
  })
})
