import { describe, expect, it } from "vitest"

import { readPublicErrorMessage } from "./public-error"

describe("public error response boundary", () => {
  it("returns a bounded message or problem detail", () => {
    expect(
      readPublicErrorMessage({ message: " Try again. " }, "Unavailable")
    ).toBe("Try again.")
    expect(
      readPublicErrorMessage({ detail: "Request rejected." }, "Unavailable")
    ).toBe("Request rejected.")
  })

  it("uses neutral copy for malformed or oversized responses", () => {
    expect(readPublicErrorMessage({ message: 42 }, "Unavailable")).toBe(
      "Unavailable"
    )
    expect(
      readPublicErrorMessage({ message: "x".repeat(501) }, "Unavailable")
    ).toBe("Unavailable")
  })
})
