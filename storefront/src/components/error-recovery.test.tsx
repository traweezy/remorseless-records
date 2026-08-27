import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import ErrorRecovery, {
  normalizeErrorDigest,
} from "@/components/error-recovery"

describe("ErrorRecovery", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("focuses safe recovery copy and retries without exposing an error", () => {
    const onRetry = vi.fn()
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)

    render(
      <ErrorRecovery digest="safe_digest-123" onRetry={onRetry} scope="route" />
    )

    const heading = screen.getByRole("heading", { name: "A track skipped" })
    expect(screen.getByRole("alert")).toHaveAccessibleName("A track skipped")
    expect(heading).toHaveFocus()
    expect(screen.queryByText(/stack|exception/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Try again" }))

    expect(onRetry).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledWith("Storefront recovery boundary rendered", {
      digest: "safe_digest-123",
      scope: "route",
    })
  })

  it("redacts malformed or oversized error digests", () => {
    expect(normalizeErrorDigest("safe-123")).toBe("safe-123")
    expect(normalizeErrorDigest("<script>alert(1)</script>")).toBe(
      "unavailable"
    )
    expect(normalizeErrorDigest("x".repeat(129))).toBe("unavailable")
    expect(normalizeErrorDigest(undefined)).toBe("unavailable")
  })
})
