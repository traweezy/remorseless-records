import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import LegalPageShell from "@/components/legal/legal-page-shell"

describe("LegalPageShell", () => {
  it("gives supporting content a unique landmark name", () => {
    render(
      <LegalPageShell
        eyebrow="Legal"
        title="Cookie Policy"
        description="Cookie policy description"
        effectiveDate="July 19, 2026"
        aside={<p>Supporting details</p>}
      >
        <p>Policy content</p>
      </LegalPageShell>
    )

    expect(
      screen.getByRole("complementary", {
        name: "Cookie Policy supporting information",
      })
    ).toHaveTextContent("Supporting details")
  })
})
