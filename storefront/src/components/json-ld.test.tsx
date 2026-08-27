import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import JsonLd, { serializeJsonLd } from "@/components/json-ld"

describe("JsonLd", () => {
  it("serializes script-closing and parser-sensitive characters safely", () => {
    const serialized = serializeJsonLd({
      name: "</script><script>alert('xss')</script>",
      ampersand: "records & tapes",
      separators: "\u2028\u2029",
    })

    expect(serialized).not.toContain("</script")
    expect(serialized).not.toContain("<script")
    expect(serialized).not.toContain("&")
    expect(serialized).not.toContain("\u2028")
    expect(serialized).not.toContain("\u2029")
    expect(JSON.parse(serialized)).toEqual({
      name: "</script><script>alert('xss')</script>",
      ampersand: "records & tapes",
      separators: "\u2028\u2029",
    })
  })

  it("renders parseable nonce-authorized application/ld+json", () => {
    const data = {
      "@context": "https://schema.org",
      name: "Remorseless Records",
    }
    const { container } = render(
      <JsonLd id="organization" data={data} nonce="test-nonce" />
    )
    const script = container.querySelector(
      "script#organization[type='application/ld+json']"
    )

    expect(script).not.toBeNull()
    expect(script).toHaveAttribute("nonce", "test-nonce")
    expect(JSON.parse(script?.textContent ?? "")).toEqual(data)
  })
})
