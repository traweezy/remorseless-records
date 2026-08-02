import { legacyCatalogAuthoringRedirect } from "./page"

describe("legacy catalog authoring route", () => {
  it("redirects to the native Medusa product list without adding history", () => {
    expect(legacyCatalogAuthoringRedirect).toEqual({
      replace: true,
      to: "/products",
    })
  })
})
