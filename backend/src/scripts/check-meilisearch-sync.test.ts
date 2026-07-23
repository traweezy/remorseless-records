import {
  assertCatalogReadModelIntegrity,
  assertPublishedProductParity,
} from "./check-meilisearch-sync"

describe("assertPublishedProductParity", () => {
  it("accepts matching published and indexed counts", () => {
    expect(() =>
      assertPublishedProductParity({
        indexedCount: 461,
        publishedProductCount: 461,
      })
    ).not.toThrow()
  })

  it("rejects a stale catalog index", () => {
    expect(() =>
      assertPublishedProductParity({
        indexedCount: 460,
        publishedProductCount: 461,
      })
    ).toThrow("does not match indexed documents")
  })
})

describe("assertCatalogReadModelIntegrity", () => {
  it("accepts a fully resolved catalog read model", () => {
    expect(() =>
      assertCatalogReadModelIntegrity({
        contradictoryStockCount: 0,
        nonPublishedCount: 0,
        unknownStockCount: 0,
      })
    ).not.toThrow()
  })

  it("rejects contradictory published stock state", () => {
    expect(() =>
      assertCatalogReadModelIntegrity({
        contradictoryStockCount: 3,
        nonPublishedCount: 0,
        unknownStockCount: 0,
      })
    ).toThrow("3 published product(s) are marked sold out")
  })

  it("rejects unresolved published stock state", () => {
    expect(() =>
      assertCatalogReadModelIntegrity({
        contradictoryStockCount: 0,
        nonPublishedCount: 0,
        unknownStockCount: 2,
      })
    ).toThrow("2 published product(s) have unknown stock")
  })

  it("rejects non-published products in the catalog index", () => {
    expect(() =>
      assertCatalogReadModelIntegrity({
        contradictoryStockCount: 0,
        nonPublishedCount: 1,
        unknownStockCount: 0,
      })
    ).toThrow("1 non-published product(s) are exposed")
  })
})
