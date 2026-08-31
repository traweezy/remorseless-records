import { renderToStaticMarkup } from "react-dom/server"

import { CatalogCheckboxField } from "./catalog-shelf-fields"

describe("catalog shelf fields", () => {
  it("gives checkbox buttons a direct accessible name", () => {
    const markup = renderToStaticMarkup(
      <CatalogCheckboxField
        checked
        id="catalog-ribbon"
        label="Show catalog ribbon"
        onChange={jest.fn()}
      />
    )

    expect(markup).toContain('aria-label="Show catalog ribbon"')
  })
})
