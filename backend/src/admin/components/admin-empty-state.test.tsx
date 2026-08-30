import { renderToStaticMarkup } from "react-dom/server"

import { AdminEmptyState } from "./admin-empty-state"

describe("AdminEmptyState", () => {
  it("announces a labelled empty state with an optional action", () => {
    const markup = renderToStaticMarkup(
      <AdminEmptyState
        action={<button type="button">Clear filters</button>}
        description="Adjust the filters to see the rest of the audit."
        icon={<span>Decorative icon</span>}
        title="No cases match these filters"
      />
    )

    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-labelledby="')
    expect(markup).toContain('aria-describedby="')
    expect(markup).toContain("<h2")
    expect(markup).toContain("No cases match these filters")
    expect(markup).toContain("Adjust the filters to see the rest of the audit.")
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain("Clear filters")
  })

  it("supports a nested section heading without an action or icon", () => {
    const markup = renderToStaticMarkup(
      <AdminEmptyState
        description="Refund evidence will appear here automatically."
        headingLevel="h3"
        title="No refunds need monitoring"
      />
    )

    expect(markup).toContain("<h3")
    expect(markup).not.toContain("<h2")
    expect(markup).not.toContain("aria-hidden")
    expect(markup).not.toContain("<button")
  })
})
