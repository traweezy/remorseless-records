import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import ProductGallery from "@/components/product-gallery"

const { reducedMotion } = vi.hoisted(() => ({
  reducedMotion: vi.fn(() => false),
}))

vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("framer-motion")>()),
  useReducedMotion: reducedMotion,
}))

vi.mock("next/image", () => ({
  default: ({
    alt,
    src,
    onError,
  }: {
    alt: string
    src: string
    onError?: () => void
  }) => (
    // biome-ignore lint/performance/noImgElement: This test double intentionally renders the browser element that Next Image wraps.
    <img alt={alt} src={src} onError={onError} />
  ),
}))

describe("ProductGallery", () => {
  afterEach(() => {
    cleanup()
    reducedMotion.mockReset().mockReturnValue(false)
  })

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

  it("moves back immediately after the last active artwork fails", async () => {
    render(
      <ProductGallery
        title="Test release"
        images={[
          { id: "one", url: "/one.jpg", alt: "Front cover" },
          { id: "two", url: "/two.jpg", alt: "Back cover" },
          { id: "three", url: "/three.jpg", alt: "Insert" },
        ]}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "View image 3 of 3" }))
    await waitFor(() =>
      expect(screen.getAllByAltText("Insert")).toHaveLength(2)
    )
    fireEvent.error(screen.getAllByAltText("Insert")[0]!)
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "View image 2 of 2" })
      ).toBeInTheDocument()
    )
    await waitFor(() =>
      expect(screen.getAllByAltText("Back cover")).toHaveLength(2)
    )
    const previous = screen.getByRole("button", { name: "Previous image" })
    fireEvent.click(previous)
    expect(previous).toBeDisabled()
    expect(screen.getByRole("button", { name: "Next image" })).toBeEnabled()
    await waitFor(() =>
      expect(screen.getAllByAltText("Front cover")).toHaveLength(2)
    )
    expect(screen.getAllByAltText("Back cover")).toHaveLength(1)
  })

  it("filters blank artwork and recovers from duplicate thumbnail failures", async () => {
    reducedMotion.mockReturnValue(true)
    render(
      <ProductGallery
        title="Test release"
        images={[
          { url: "  ", alt: "Blank artwork" },
          { url: "/front.jpg", alt: "Front cover" },
          { url: "/back.jpg", alt: "Back cover" },
        ]}
      />
    )
    expect(screen.queryByAltText("Blank artwork")).not.toBeInTheDocument()
    const thumbnail = screen
      .getByRole("button", { name: "View image 2 of 2" })
      .querySelector("img")!
    act(() => {
      fireEvent.error(thumbnail)
      fireEvent.error(thumbnail)
    })
    expect(
      screen.queryByRole("button", { name: "Next image" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /View image/ })
    ).not.toBeInTheDocument()
    expect(screen.getByAltText("Front cover")).toHaveAttribute(
      "src",
      "/front.jpg"
    )
    fireEvent.error(screen.getByAltText("Front cover"))
    expect(screen.getByText("Artwork unavailable")).toBeInTheDocument()
    expect(screen.queryByAltText("Front cover")).not.toBeInTheDocument()
  })

  it("renders the artwork fallback when the release has no images", () => {
    render(<ProductGallery title="Test release" images={[]} />)
    expect(screen.getByText("Artwork unavailable")).toBeInTheDocument()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })
})
