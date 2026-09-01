import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const consent = vi.hoisted(() => ({
  isHydrated: false,
  analytics: false,
}))

vi.mock("@/components/legal/cookie-consent-provider", () => ({
  useCookieConsent: () => ({
    isHydrated: consent.isHydrated,
    preferences: {
      necessary: true,
      analytics: consent.analytics,
      marketing: false,
      version: 1,
      updatedAt: "2026-08-31T00:00:00.000Z",
    },
  }),
}))

vi.mock("@/components/web-vitals-reporter", () => ({
  default: () => <span data-testid="web-vitals-reporter" />,
}))

import ConsentAwareWebVitalsReporter from "@/components/consent-aware-web-vitals-reporter"

describe("ConsentAwareWebVitalsReporter", () => {
  beforeEach(() => {
    consent.isHydrated = false
    consent.analytics = false
  })

  afterEach(() => {
    cleanup()
  })

  it("does not mount optional telemetry before consent hydration", () => {
    render(<ConsentAwareWebVitalsReporter />)

    expect(screen.queryByTestId("web-vitals-reporter")).not.toBeInTheDocument()
  })

  it("mounts telemetry only while analytics consent is enabled", () => {
    consent.isHydrated = true
    const { rerender } = render(
      <ConsentAwareWebVitalsReporter key="analytics-disabled" />
    )
    expect(screen.queryByTestId("web-vitals-reporter")).not.toBeInTheDocument()

    consent.analytics = true
    rerender(<ConsentAwareWebVitalsReporter key="analytics-enabled" />)
    expect(screen.getByTestId("web-vitals-reporter")).toBeInTheDocument()

    consent.analytics = false
    rerender(<ConsentAwareWebVitalsReporter key="analytics-revoked" />)
    expect(screen.queryByTestId("web-vitals-reporter")).not.toBeInTheDocument()
  })
})
