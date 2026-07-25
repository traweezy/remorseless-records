import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useEffect } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useCarouselAutoScroll } from "@/hooks/use-carousel-auto-scroll"

const mediaQuery = {
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}

const autoScroll = {
  play: vi.fn(),
  pause: vi.fn(),
  isPaused: vi.fn(),
}

const carousel = {
  go: vi.fn(),
  root: document.createElement("div"),
  Components: { AutoScroll: autoScroll },
}

type AutoScrollProbeProps = {
  instance?: unknown
}

const AutoScrollProbe = ({ instance = carousel }: AutoScrollProbeProps) => {
  const { destroy, go, isPaused, mount, toggle } = useCarouselAutoScroll()

  useEffect(() => {
    mount(instance)
    return destroy
  }, [destroy, instance, mount])

  return (
    <>
      <output>{isPaused ? "paused" : "playing"}</output>
      <button type="button" onClick={toggle}>
        Toggle
      </button>
      <button type="button" onClick={() => go("+1")}>
        Next
      </button>
    </>
  )
}

describe("useCarouselAutoScroll", () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    mediaQuery.matches = false
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => mediaQuery)
    )
  })

  it("starts, pauses, resumes, and navigates the mounted carousel", () => {
    render(<AutoScrollProbe />)

    expect(autoScroll.play).toHaveBeenCalledTimes(1)
    expect(screen.getByText("playing")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Toggle" }))
    expect(autoScroll.pause).toHaveBeenCalledTimes(1)
    expect(screen.getByText("paused")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Toggle" }))
    expect(autoScroll.play).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(carousel.go).toHaveBeenCalledWith("+1")
  })

  it("does not start automatically when reduced motion is preferred", () => {
    mediaQuery.matches = true

    render(<AutoScrollProbe />)

    expect(autoScroll.pause).toHaveBeenCalledTimes(1)
    expect(autoScroll.play).not.toHaveBeenCalled()
    expect(screen.getByText("paused")).toBeInTheDocument()
  })

  it("reacts to reduced-motion preference changes", () => {
    const { unmount } = render(<AutoScrollProbe />)
    const listener = mediaQuery.addEventListener.mock.calls[0]?.[1] as
      ((event: MediaQueryListEvent) => void) | undefined

    expect(listener).toBeDefined()

    act(() => {
      listener?.({ matches: true } as MediaQueryListEvent)
    })
    expect(autoScroll.pause).toHaveBeenCalledTimes(1)
    expect(screen.getByText("paused")).toBeInTheDocument()

    act(() => {
      listener?.({ matches: false } as MediaQueryListEvent)
    })
    expect(autoScroll.play).toHaveBeenCalledTimes(2)
    expect(screen.getByText("playing")).toBeInTheDocument()

    unmount()
    expect(mediaQuery.removeEventListener).toHaveBeenCalledWith(
      "change",
      listener
    )
  })

  it("keeps a manually paused carousel paused after motion is allowed", () => {
    render(<AutoScrollProbe />)
    const listener = mediaQuery.addEventListener.mock.calls[0]?.[1] as
      ((event: MediaQueryListEvent) => void) | undefined

    fireEvent.click(screen.getByRole("button", { name: "Toggle" }))
    act(() => {
      listener?.({ matches: true } as MediaQueryListEvent)
      listener?.({ matches: false } as MediaQueryListEvent)
    })

    expect(autoScroll.play).toHaveBeenCalledTimes(1)
    expect(screen.getByText("paused")).toBeInTheDocument()
  })

  it("remains safe when the carousel has no auto-scroll extension", () => {
    render(
      <AutoScrollProbe
        instance={{
          go: carousel.go,
          root: carousel.root,
          Components: {},
        }}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Toggle" }))

    expect(autoScroll.play).not.toHaveBeenCalled()
    expect(autoScroll.pause).not.toHaveBeenCalled()
    expect(screen.getByText("paused")).toBeInTheDocument()
  })
})
