import { describe, expect, it } from "vitest"

import { normalizeRibbonLabel } from "@/lib/products/ribbons"

describe("normalizeRibbonLabel", () => {
  it.each([
    "New in Store",
    "New Release",
    "new release",
    "New Releases",
    "Newest Arrivals",
  ])("shortens the legacy %s label", (label) => {
    expect(normalizeRibbonLabel(label)).toBe("New")
  })

  it("preserves other trimmed labels", () => {
    expect(normalizeRibbonLabel("  Staff Pick  ")).toBe("Staff Pick")
  })

  it("rejects empty labels", () => {
    expect(normalizeRibbonLabel("   ")).toBeNull()
  })
})
