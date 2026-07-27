import {
  assertCatalogReadModelIntegrity,
  assertExactDocumentIds,
  assertPublishedProductParity,
  assertRequiredDocumentFields,
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

describe("catalog document integrity", () => {
  it("accepts exact IDs and required catalog fields", () => {
    expect(() =>
      assertExactDocumentIds({
        indexedIds: ["prod_1", "prod_2"],
        publishedIds: ["prod_2", "prod_1"],
      })
    ).not.toThrow()
    expect(() =>
      assertRequiredDocumentFields([
        {
          handle: "album-one",
          id: "prod_1",
          product_type: "music_release",
          status: "published",
          stock_status: "available",
          title: "Album One",
        },
      ])
    ).not.toThrow()
  })

  it("rejects substituted, duplicate, and incomplete documents", () => {
    expect(() =>
      assertExactDocumentIds({
        indexedIds: ["prod_1", "prod_1"],
        publishedIds: ["prod_1", "prod_2"],
      })
    ).toThrow("Missing: 1; unexpected: 0; duplicate indexed IDs: 1")
    expect(() =>
      assertRequiredDocumentFields([
        {
          handle: "",
          id: "prod_1",
          product_type: "music_release",
          status: "published",
          stock_status: "available",
          title: "Album One",
        },
      ])
    ).toThrow("missing required catalog fields")
  })
})
