import {
  getCatalogProductOptionPath,
  getPrimaryProductLoadPath,
  getRemainingProductOptionOffsets,
  mergeExactProduct,
  mergeProductOptions,
  shouldLoadBundleProductOptions,
} from "./product-option-loading"

describe("catalog product option loading", () => {
  it("loads an exact product for a dedicated editor", () => {
    expect(getPrimaryProductLoadPath("prod/selected")).toBe(
      "/admin/products/prod%2Fselected?fields=*variants,*variants.prices"
    )
    expect(getPrimaryProductLoadPath(undefined)).toBe(
      "/admin/products?limit=200&offset=0&fields=*variants,*variants.prices"
    )
  })

  it("calculates bounded option pages for the complete catalog", () => {
    expect(getCatalogProductOptionPath(400)).toBe(
      "/admin/products?limit=200&offset=400&fields=*variants,*variants.prices"
    )
    expect(getRemainingProductOptionOffsets(0)).toEqual([])
    expect(getRemainingProductOptionOffsets(200)).toEqual([])
    expect(getRemainingProductOptionOffsets(201)).toEqual([200])
    expect(getRemainingProductOptionOffsets(462)).toEqual([200, 400])
  })

  it("replaces the exact product without discarding loaded choices", () => {
    expect(
      mergeExactProduct(
        { id: "prod_selected", title: "Updated" },
        [
          { id: "prod_selected", title: "Stale" },
          { id: "prod_component", title: "Component" },
        ]
      )
    ).toEqual([
      { id: "prod_selected", title: "Updated" },
      { id: "prod_component", title: "Component" },
    ])
  })

  it("keeps the exact product when a bundle option page omits it", () => {
    expect(
      mergeProductOptions(
        [{ id: "prod_selected", title: "Selected" }],
        [{ id: "prod_component", title: "Component" }],
        "prod_selected"
      )
    ).toEqual([
      { id: "prod_selected", title: "Selected" },
      { id: "prod_component", title: "Component" },
    ])
  })

  it("loads choices only for an idle dedicated bundle editor", () => {
    expect(
      shouldLoadBundleProductOptions({
        bundleEnabled: true,
        dedicatedProductId: "prod_bundle",
        status: "idle",
      })
    ).toBe(true)
    expect(
      shouldLoadBundleProductOptions({
        bundleEnabled: false,
        dedicatedProductId: "prod_bundle",
        status: "idle",
      })
    ).toBe(false)
    expect(
      shouldLoadBundleProductOptions({
        bundleEnabled: true,
        dedicatedProductId: "prod_bundle",
        status: "ready",
      })
    ).toBe(false)
    expect(
      shouldLoadBundleProductOptions({
        bundleEnabled: true,
        dedicatedProductId: undefined,
        status: "idle",
      })
    ).toBe(false)
  })
})
