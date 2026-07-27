import { renderToStaticMarkup } from "react-dom/server"

import RichTextEditor from "./rich-text-editor"

describe("RichTextEditor", () => {
  it("exposes a contextual accessible name", () => {
    const markup = renderToStaticMarkup(
      <RichTextEditor
        ariaLabel="Rich product description"
        onChange={() => undefined}
        value="<p>Initial copy</p>"
      />
    )

    expect(markup).toContain('role="textbox"')
    expect(markup).toContain('aria-label="Rich product description"')
  })
})
