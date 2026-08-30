import { renderToStaticMarkup } from "react-dom/server"

import { AdminStatCard } from "./admin-stat-card"

describe("AdminStatCard", () => {
  it("renders a consistent label, value, and optional description", () => {
    const markup = renderToStaticMarkup(
      <AdminStatCard description="Requires review" label="Exceptions">
        <strong>3</strong>
      </AdminStatCard>
    )

    expect(markup).toContain(">Exceptions</")
    expect(markup).toContain("<strong>3</strong>")
    expect(markup).toContain(">Requires review</")
    expect(markup).toContain("border-ui-border-base")
  })

  it("omits an empty description", () => {
    const markup = renderToStaticMarkup(
      <AdminStatCard label="Verified">12</AdminStatCard>
    )

    expect(markup).toContain(">Verified</")
    expect(markup).toContain(">12</")
    expect(markup.match(/text-ui-fg-subtle/g)).toHaveLength(1)
  })
})
