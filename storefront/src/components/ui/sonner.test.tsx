import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { StrictMode } from "react"
import { toast } from "sonner"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { Toaster } from "./sonner"

const flushToastUpdates = async (): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50)
  })
}

describe("Storefront notifications", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(async () => {
    act(() => {
      toast.dismiss()
    })
    cleanup()
    await vi.runOnlyPendingTimersAsync()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it("announces errors and exposes an accessible dismiss button in StrictMode", async () => {
    render(
      <StrictMode>
        <Toaster />
      </StrictMode>
    )

    act(() => {
      toast.error("Unable to update your cart. Please try again.", {
        duration: Number.POSITIVE_INFINITY,
      })
    })
    await flushToastUpdates()

    expect(
      screen.getByRole("region", { name: /Notifications/ })
    ).toHaveAttribute("aria-live", "polite")
    expect(
      screen.getByText("Unable to update your cart. Please try again.")
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Close toast" }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(
      screen.queryByText("Unable to update your cart. Please try again.")
    ).not.toBeInTheDocument()
  })

  it("preserves an error raised before the app's trailing Toaster mounts", async () => {
    // RootLayout renders CartProvider before Toaster, so provider errors can
    // arrive before the notification surface subscribes during mounting.
    toast.error("Your cart could not be restored.", {
      duration: Number.POSITIVE_INFINITY,
    })
    render(<Toaster />)
    await flushToastUpdates()

    expect(
      screen.getByText("Your cart could not be restored.")
    ).toBeInTheDocument()
  })

  it("removes notification visibility listeners when the surface unmounts", async () => {
    const addListener = vi.spyOn(document, "addEventListener")
    const removeListener = vi.spyOn(document, "removeEventListener")
    const view = render(<Toaster />)
    act(() => {
      toast.error("The cart update failed.", {
        duration: Number.POSITIVE_INFINITY,
      })
    })
    await flushToastUpdates()

    const visibilityListeners = addListener.mock.calls.filter(
      ([eventName]) => eventName === "visibilitychange"
    )
    expect(visibilityListeners.length).toBeGreaterThan(0)
    view.unmount()
    for (const [eventName, listener] of visibilityListeners) {
      expect(removeListener).toHaveBeenCalledWith(eventName, listener)
    }
  })
})
