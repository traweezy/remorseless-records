import {
  hasVisibleRichText,
  richTextToPlainText,
  sanitizeRichTextHtml,
} from "./rich-text"

describe("rich-text sanitization", () => {
  it("preserves the supported authoring markup", () => {
    expect(
      sanitizeRichTextHtml(
        "<h2>Release</h2><p>New <strong>record</strong>.</p><hr>"
      )
    ).toBe("<h2>Release</h2><p>New <strong>record</strong>.</p><hr />")
  })

  it.each([
    '<script>alert("xss")</script><p>Safe</p>',
    '<img src=x onerror="alert(1)"><p>Safe</p>',
    '<svg><a xlink:href="javascript:alert(1)">bad</a></svg><p>Safe</p>',
    '<svg><animate attributeName="href" values="https://safe.example;javascript:alert(1)"></animate></svg><p>Safe</p>',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe><p>Safe</p>',
    "<math><mtext><option><style><img src=x onerror=alert(1)></style></option></mtext></math><p>Safe</p>",
  ])("removes executable markup from %s", (input) => {
    const sanitized = sanitizeRichTextHtml(input)

    expect(sanitized).toContain("<p>Safe</p>")
    expect(sanitized).not.toMatch(
      /script|onerror|javascript:|srcdoc|xlink|iframe|svg|math/i
    )
  })

  it("keeps safe links and applies a fixed external-link policy", () => {
    expect(
      sanitizeRichTextHtml(
        '<a href="https://example.com/path">Web</a> <a href="mailto:label@example.com">Email</a>'
      )
    ).toBe(
      '<a href="https://example.com/path" target="_blank" rel="noopener noreferrer">Web</a> <a href="mailto:label@example.com" target="_blank" rel="noopener noreferrer">Email</a>'
    )
  })

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "//evil.example/path",
  ])("removes unsafe link target %s", (href) => {
    expect(sanitizeRichTextHtml(`<a href="${href}">Unsafe</a>`)).toBe(
      "<a>Unsafe</a>"
    )
  })

  it("removes attributes and styles outside the allow-list", () => {
    expect(
      sanitizeRichTextHtml(
        '<p id="clobber" class="hidden" style="display:none" onclick="alert(1)">Visible</p>'
      )
    ).toBe("<p>Visible</p>")
  })

  it("unwraps unknown formatting while retaining safe text", () => {
    expect(
      sanitizeRichTextHtml(
        "<custom-element>Keep <em>this</em></custom-element>"
      )
    ).toBe("Keep <em>this</em>")
  })

  it("produces plain text for metadata and visible-content checks", () => {
    expect(richTextToPlainText("<p>Hello <strong>world</strong></p>")).toBe(
      "Hello world"
    )
    expect(hasVisibleRichText("<script>alert(1)</script>")).toBe(false)
    expect(hasVisibleRichText("<p>&nbsp;</p>")).toBe(false)
    expect(hasVisibleRichText("<p>Release notes</p>")).toBe(true)
  })
})
