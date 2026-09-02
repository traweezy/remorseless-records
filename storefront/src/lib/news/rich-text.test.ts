import { faker } from "@faker-js/faker"
import { beforeEach, describe, expect, it } from "vitest"

import { sanitizeNewsHtml } from "@/lib/news/rich-text"

describe("sanitizeNewsHtml", () => {
  beforeEach(() => {
    faker.seed(3101)
  })

  it("returns an empty string for empty input", () => {
    expect(sanitizeNewsHtml("")).toBe("")
  })

  it("preserves supported markup and normalizes safe links", () => {
    const safeUrl = faker.internet.url()

    expect(
      sanitizeNewsHtml(
        `<h2>Release</h2><p>Read <strong>more</strong> <a href="${safeUrl}">here</a>.</p>`
      )
    ).toBe(
      `<h2>Release</h2><p>Read <strong>more</strong> <a href="${safeUrl}" target="_blank" rel="noopener noreferrer">here</a>.</p>`
    )
  })

  it.each([
    '<script>alert("xss")</script><p>Safe</p>',
    '<img src=x onerror="alert(1)"><p>Safe</p>',
    '<svg><a xlink:href="javascript:alert(1)">bad</a></svg><p>Safe</p>',
    '<svg><animate attributeName="href" values="https://safe.example;javascript:alert(1)"></animate></svg><p>Safe</p>',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe><p>Safe</p>',
    "<math><mtext><option><style><img src=x onerror=alert(1)></style></option></mtext></math><p>Safe</p>",
  ])("removes executable markup from %s", (input) => {
    const sanitized = sanitizeNewsHtml(input)

    expect(sanitized).toContain("<p>Safe</p>")
    expect(sanitized).not.toMatch(
      /script|onerror|javascript:|srcdoc|xlink|iframe|svg|math/i
    )
  })

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "//evil.example/path",
  ])("removes unsafe link target %s", (href) => {
    expect(sanitizeNewsHtml(`<a href="${href}">Unsafe</a>`)).toBe(
      "<a>Unsafe</a>"
    )
  })

  it("removes attributes and styles outside the allow-list", () => {
    expect(
      sanitizeNewsHtml(
        '<p id="clobber" class="hidden" style="display:none" onclick="alert(1)">Visible</p>'
      )
    ).toBe("<p>Visible</p>")
  })

  it("unwraps unknown formatting while retaining safe text", () => {
    expect(
      sanitizeNewsHtml("<custom-element>Keep <em>this</em></custom-element>")
    ).toBe("Keep <em>this</em>")
  })
})
