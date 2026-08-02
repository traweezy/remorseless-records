import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"

import { ContentPage, config } from "./page"

describe("Content Admin route", () => {
  it("presents one overview and two clearly separated workspaces", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ContentPage />
      </MemoryRouter>,
    )

    expect(config).toMatchObject({ label: "Content", rank: 1 })
    expect(markup).toContain(">Content</h1>")
    expect(markup).toContain(">News</h2>")
    expect(markup).toContain(">Discography</h2>")
    expect(markup).toContain('href="/content/news"')
    expect(markup).toContain('href="/content/discography"')
    expect(markup).toContain("2 workspaces")
  })
})
