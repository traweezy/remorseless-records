import {
  legacyCatalogAuthoringRedirectTarget,
  replaceLegacyCatalogAuthoringLocation,
} from "./page"

describe("legacy catalog authoring route", () => {
  it("redirects to the native Medusa product list without adding history", () => {
    const replace = jest.fn()

    replaceLegacyCatalogAuthoringLocation({ replace })

    expect(legacyCatalogAuthoringRedirectTarget).toBe("/app/products")
    expect(replace).toHaveBeenCalledWith("/app/products")
  })
})
