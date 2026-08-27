import { render } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import JsonLd, { serializeJsonLd } from "@/components/json-ld"

const headersMock = vi.hoisted(() => vi.fn())

vi.mock("next/headers", () => ({
  headers: headersMock,
}))

describe("JsonLd", () => {
  beforeEach(() => {
    headersMock.mockResolvedValue(
      new Headers([["x-nonce", "request-header-nonce"]])
    )
  })

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

  it("renders parseable nonce-authorized application/ld+json", async () => {
    const data = {
      "@context": "https://schema.org",
      name: "Remorseless Records",
    }
    const { container } = render(
      await JsonLd({ id: "organization", data, nonce: "test-nonce" })
    )
    const script = container.querySelector(
      "script#organization[type='application/ld+json']"
    )

    expect(script).not.toBeNull()
    expect(script).toHaveAttribute("nonce", "test-nonce")
    expect(JSON.parse(script?.textContent ?? "")).toEqual(data)
  })

  it("inherits the request nonce when callers omit it", async () => {
    const { container } = render(
      await JsonLd({ data: { name: "Catalog" }, id: "catalog" })
    )

    expect(container.querySelector("script#catalog")).toHaveAttribute(
      "nonce",
      "request-header-nonce"
    )
  })
})
