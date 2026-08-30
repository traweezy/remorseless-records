import { renderToStaticMarkup } from "react-dom/server"

import { AdminRetryState } from "./admin-retry-state"

describe("AdminRetryState", () => {
  it("names the failure and exposes an actual retry button", () => {
    const markup = renderToStaticMarkup(
      <AdminRetryState
        message="The report could not be loaded."
        onRetry={jest.fn()}
        title="Tax records are unavailable"
      />
    )

    expect(markup).toContain("Tax records are unavailable")
    expect(markup).toContain("The report could not be loaded.")
    expect(markup).toContain("<button")
    expect(markup).toContain('type="button"')
    expect(markup).toContain("Try again")
    expect(markup).not.toContain(' disabled=""')
    expect(markup).toContain('role="alert"')
  })

  it("locks duplicate retries while a request is pending", () => {
    const markup = renderToStaticMarkup(
      <AdminRetryState
        message="The report could not be loaded."
        onRetry={jest.fn()}
        retrying
        title="Tax records are unavailable"
      />
    )

    expect(markup).toContain("disabled")
    expect(markup).toContain('aria-busy="true"')
  })
})
