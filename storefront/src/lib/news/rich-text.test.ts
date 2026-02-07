import { faker } from "@faker-js/faker"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { sanitizeNewsHtml } from "@/lib/news/rich-text"

describe("sanitizeNewsHtml", () => {
  beforeEach(() => {
    faker.seed(3101)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns an empty string for empty input", () => {
    expect(sanitizeNewsHtml("")).toBe("")
  })

  it("removes blocked tags, strips unsafe attributes, and unwraps unknown tags", () => {
    const safeUrl = faker.internet.url()

    const sanitized = sanitizeNewsHtml(
      [
        '<p onclick="evil()">Intro <span>wrapped</span></p>',
        '<script>alert("xss")</script>',
        '<iframe src="https://evil.example"></iframe>',
        '<a href="javascript:alert(1)" style="color:red">unsafe</a>',
        `<a href="${safeUrl}">safe</a>`,
      ].join("")
    )

    expect(sanitized).toContain("<p>Intro wrapped</p>")
    expect(sanitized).not.toContain("script")
    expect(sanitized).not.toContain("iframe")
    expect(sanitized).not.toContain("onclick")
    expect(sanitized).toContain("<a>unsafe</a>")
    expect(sanitized).toContain(
      `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">safe</a>`
    )
  })

  it("treats invalid URL values as unsafe", () => {
    const sanitized = sanitizeNewsHtml('<a href="http://%zz">bad-link</a>')
    expect(sanitized).toBe("<a>bad-link</a>")
  })

  it("removes href when anchor link has no href attribute", () => {
    const sanitized = sanitizeNewsHtml("<a>plain-link</a>")
    expect(sanitized).toBe("<a>plain-link</a>")
  })

  it("returns raw input when DOMParser is unavailable", () => {
    vi.stubGlobal("DOMParser", undefined)

    const input = "<p>raw-html</p>"
    expect(sanitizeNewsHtml(input)).toBe(input)
  })

  it("returns an empty string when parser output has no body", () => {
    class BodylessParser {
      parseFromString(): Document {
        return { body: null } as unknown as Document
      }
    }

    vi.stubGlobal("DOMParser", BodylessParser)
    expect(sanitizeNewsHtml("<p>test</p>")).toBe("")
  })

  it("drops unknown orphan elements when they do not have a parent node", () => {
    const remove = vi.fn()
    const orphanNode = {
      nodeType: Node.ELEMENT_NODE,
      tagName: "custom-tag",
      parentNode: null,
      childNodes: [],
      attributes: [],
      remove,
      removeAttribute: vi.fn(),
      getAttribute: vi.fn(),
      setAttribute: vi.fn(),
    } as unknown as Element

    class OrphanParser {
      parseFromString(): Document {
        return {
          body: {
            childNodes: [orphanNode],
            innerHTML: "",
          },
        } as unknown as Document
      }
    }

    vi.stubGlobal("DOMParser", OrphanParser)
    sanitizeNewsHtml("<custom-tag></custom-tag>")
    expect(remove).toHaveBeenCalledOnce()
  })

  it("falls back to an empty string when body.innerHTML is null", () => {
    class NullInnerHtmlParser {
      parseFromString(): Document {
        return {
          body: {
            childNodes: [],
            innerHTML: null,
          },
        } as unknown as Document
      }
    }

    vi.stubGlobal("DOMParser", NullInnerHtmlParser)
    expect(sanitizeNewsHtml("<p>ignored</p>")).toBe("")
  })
})
