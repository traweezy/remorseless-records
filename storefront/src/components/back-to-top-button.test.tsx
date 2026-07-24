import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import BackToTopButton from "@/components/back-to-top-button"

const motionPreferences = vi.hoisted(() => ({
  reduced: false,
}))
const scrollToMock = vi.fn()

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    div: ({
      children,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      ...props
    }: {
      children: ReactNode
      initial?: unknown
      animate?: unknown
      exit?: unknown
      transition?: unknown
    }) => <div {...props}>{children}</div>,
  },
  useReducedMotion: () => motionPreferences.reduced,
}))

const setViewport = ({
  scrollY,
  scrollHeight,
  innerHeight = 800,
}: {
  scrollY: number
  scrollHeight: number
  innerHeight?: number
}) => {
  Object.defineProperty(window, "scrollY", {
    configurable: true,
    value: scrollY,
  })
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: innerHeight,
  })
  Object.defineProperty(document.documentElement, "scrollHeight", {
    configurable: true,
    value: scrollHeight,
  })
}

describe("BackToTopButton", () => {
  beforeEach(() => {
    motionPreferences.reduced = false
    setViewport({ scrollY: 0, scrollHeight: 2_000 })
    scrollToMock.mockReset()
    vi.stubGlobal("scrollTo", scrollToMock)
  })

  afterEach(cleanup)

  it("only appears after a scrollable page has been meaningfully scrolled", () => {
    render(<BackToTopButton />)

    expect(
      screen.queryByRole("button", { name: "Back to top" })
    ).not.toBeInTheDocument()

    setViewport({ scrollY: 500, scrollHeight: 2_000 })
    act(() => {
      fireEvent.scroll(window)
    })

    expect(
      screen.getByRole("button", { name: "Back to top" })
    ).toBeInTheDocument()

    setViewport({ scrollY: 500, scrollHeight: 700 })
    act(() => {
      fireEvent.resize(window)
    })

    expect(
      screen.queryByRole("button", { name: "Back to top" })
    ).not.toBeInTheDocument()
  })

  it("smoothly returns to the top and moves focus to main content", () => {
    setViewport({ scrollY: 500, scrollHeight: 2_000 })
    render(
      <>
        <main id="main-content" tabIndex={-1}>
          Catalog
        </main>
        <BackToTopButton />
      </>
    )

    fireEvent.click(screen.getByRole("button", { name: "Back to top" }))

    expect(scrollToMock).toHaveBeenCalledWith({
      top: 0,
      behavior: "smooth",
    })
    expect(document.getElementById("main-content")).toHaveFocus()
  })

  it("returns immediately when reduced motion is preferred", () => {
    motionPreferences.reduced = true
    setViewport({ scrollY: 500, scrollHeight: 2_000 })
    render(<BackToTopButton />)

    fireEvent.click(screen.getByRole("button", { name: "Back to top" }))

    expect(scrollToMock).toHaveBeenCalledWith({
      top: 0,
      behavior: "auto",
    })
  })
})
