import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { RichText } from "./rich-text"

describe("RichText", () => {
  it("renders formatting, entities, whitespace, lists and void elements as React nodes", () => {
    expect(
      renderToStaticMarkup(
        <RichText
          html={
            "<h2>A &amp; B</h2><p>Read <strong>this</strong><br>then &lt;tag&gt;.</p><hr><ol><li><em>One</em></li></ol>"
          }
        />
      )
    ).toBe(
      "<h2>A &amp; B</h2><p>Read <strong>this</strong><br/>then &lt;tag&gt;.</p><hr/><ol><li><em>One</em></li></ol>"
    )
  })

  it("retains safe links and discards executable markup and arbitrary attributes", () => {
    expect(
      renderToStaticMarkup(
        <RichText
          html={
            '<script>alert(1)</script><p id="clobber" style="display:none" onclick="alert(1)">Text &lt;img onerror=alert(1)&gt;<a href="javascript:alert(1)">Unsafe</a><a href="https://example.com/?a=1&amp;b=2" target="_self">Safe</a></p>'
          }
        />
      )
    ).toBe(
      '<p>Text &lt;img onerror=alert(1)&gt;<a>Unsafe</a><a href="https://example.com/?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">Safe</a></p>'
    )
  })

  it("returns an empty tree for empty or fully removed content", () => {
    expect(RichText({ html: "" })).toEqual([])
    expect(
      RichText({ html: "<script>alert(1)</script><!-- hidden -->" })
    ).toEqual([])
  })

  it("never sends raw HTML insertion props to client navigation", () => {
    const nodes = RichText({
      html: "<div><p><strong>Nested</strong><img src=x onerror=alert(1)></p></div>",
    })
    expect(JSON.stringify(nodes)).not.toContain("dangerouslySetInnerHTML")
    expect(renderToStaticMarkup(nodes)).toBe("<p><strong>Nested</strong></p>")
  })
})
