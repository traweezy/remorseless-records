import { renderToStaticMarkup } from "react-dom/server"

import { CatalogMerchandiseTemplates } from "./catalog-merchandise-templates"

describe("CatalogMerchandiseTemplates", () => {
  it("explains replacement safety and exposes every preset", () => {
    const markup = renderToStaticMarkup(
      <CatalogMerchandiseTemplates currentCount={3} onApply={jest.fn()} />
    )

    expect(markup).toContain("Start from a merchandise template")
    expect(markup).toContain("One size · 1")
    expect(markup).toContain("Apparel S–2XL · 5")
    expect(markup).toContain("Apparel XS–3XL · 7")
    expect(markup).toContain("stock resets to zero")
    expect(markup).toContain("nothing can be oversold accidentally")
  })
})
