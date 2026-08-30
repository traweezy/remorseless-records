import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import ProductGallery from "@/components/product-gallery"

vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    // biome-ignore lint/performance/noImgElement: This test double intentionally renders the browser element that Next Image wraps.
    <img alt={alt} src={src} />
  ),
}))

describe("ProductGallery", () => {
  afterEach(cleanup)

  it("offers accessible previous and next image controls", () => {
    render(
      <ProductGallery
        title="Test release"
        images={[
          { id: "one", url: "/one.jpg", alt: "Front cover" },
          { id: "two", url: "/two.jpg", alt: "Back cover" },
        ]}
      />
    )

    const previous = screen.getByRole("button", { name: "Previous image" })
    const next = screen.getByRole("button", { name: "Next image" })

    expect(previous).toBeDisabled()
    expect(next).toBeEnabled()

    fireEvent.click(next)

    expect(previous).toBeEnabled()
    expect(next).toBeDisabled()
    expect(screen.getByAltText("Back cover")).toHaveAttribute("src", "/two.jpg")
  })
})
