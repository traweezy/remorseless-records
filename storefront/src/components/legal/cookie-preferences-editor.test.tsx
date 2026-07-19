import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import CookiePreferencesEditor from "@/components/legal/cookie-preferences-editor"

const consent = vi.hoisted(() => ({
  acceptAll: vi.fn(),
  rejectNonEssential: vi.fn(),
  saveSelection: vi.fn(),
}))

vi.mock("@/components/legal/cookie-consent-provider", () => ({
  useCookieConsent: () => ({
    preferences: { analytics: false, marketing: false },
    ...consent,
  }),
}))

describe("CookiePreferencesEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it("names every cookie checkbox without collision-prone ids", () => {
    render(<CookiePreferencesEditor />)

    const necessary = screen.getByRole("checkbox", {
      name: "Strictly necessary cookies",
    })
    const analytics = screen.getByRole("checkbox", { name: "Analytics cookies" })
    const marketing = screen.getByRole("checkbox", { name: "Marketing cookies" })

    expect(necessary).toBeDisabled()
    expect(necessary).not.toHaveAttribute("id")
    expect(analytics).not.toHaveAttribute("id")
    expect(marketing).not.toHaveAttribute("id")
    expect(analytics).toHaveClass("h-6", "w-6")
  })

  it("saves the changed analytics preference", () => {
    render(<CookiePreferencesEditor />)

    fireEvent.click(screen.getByRole("checkbox", { name: "Analytics cookies" }))

    expect(consent.saveSelection).toHaveBeenCalledWith({
      analytics: true,
      marketing: false,
    })
  })
})
