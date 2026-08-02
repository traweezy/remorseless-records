import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"

import { ContentWorkspaceNavigation } from "./content-navigation"

describe("ContentWorkspaceNavigation", () => {
  it("marks one workspace current and links all sibling routes", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ContentWorkspaceNavigation active="news" />
      </MemoryRouter>,
    )

    expect(markup).toContain('aria-label="Content workspaces"')
    expect(markup).toContain('href="/content"')
    expect(markup).toContain('href="/content/news"')
    expect(markup).toContain('href="/content/discography"')
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1)
    expect(markup).toMatch(
      /<a[^>]*aria-current="page"[^>]*href="\/content\/news"[^>]*>News<\/a>/,
    )
  })

  it("omits workspaces the current role cannot read", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ContentWorkspaceNavigation
          active="news"
          showDiscography={false}
        />
      </MemoryRouter>,
    )

    expect(markup).toContain('href="/content"')
    expect(markup).toContain('href="/content/news"')
    expect(markup).not.toContain('href="/content/discography"')
  })
})
