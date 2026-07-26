import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import BandcampEmbed, {
  normalizeBandcampAlbumId,
  normalizeBandcampAlbumSlug,
} from "@/components/contact/bandcamp-embed"

const consent = vi.hoisted(() => ({
  isHydrated: true,
  preferences: { analytics: false, marketing: false },
  saveSelection: vi.fn(),
}))

vi.mock("@/components/legal/cookie-consent-provider", () => ({
  useCookieConsent: () => consent,
}))

describe("BandcampEmbed", () => {
  beforeEach(() => {
    consent.isHydrated = true
    consent.preferences = { analytics: false, marketing: false }
    consent.saveSelection.mockReset()
  })

  it("loads external media only after an explicit consent action", () => {
    consent.preferences.analytics = true
    render(<BandcampEmbed />)

    expect(screen.queryByTitle(/featured remorseless/i)).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", { name: "Enable Bandcamp player" })
    )

    expect(consent.saveSelection).toHaveBeenCalledWith({
      analytics: true,
      marketing: true,
    })
  })

  it("renders the player when external media consent is already enabled", () => {
    consent.preferences.marketing = true
    render(<BandcampEmbed />)

    expect(screen.getByTitle(/featured remorseless/i)).toHaveAttribute(
      "src",
      expect.stringContaining("https://bandcamp.com/EmbeddedPlayer/")
    )
  })

  it("rejects malformed build-time album identifiers", () => {
    expect(normalizeBandcampAlbumId("2916008899")).toBe("2916008899")
    expect(normalizeBandcampAlbumId("album=<script>")).toBe("2916008899")
    expect(normalizeBandcampAlbumSlug(" Samudaripen ")).toBe("samudaripen")
    expect(normalizeBandcampAlbumSlug("../unexpected")).toBe("samudaripen")
  })
})
