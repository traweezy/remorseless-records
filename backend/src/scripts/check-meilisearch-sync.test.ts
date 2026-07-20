import { assertCatalogReadModelIntegrity } from "./check-meilisearch-sync"

describe("assertCatalogReadModelIntegrity", () => {
  it("accepts a fully resolved catalog read model", () => {
    expect(() =>
      assertCatalogReadModelIntegrity({
        contradictoryStockCount: 0,
        unknownStockCount: 0,
      })
    ).not.toThrow()
  })

  it("rejects contradictory published stock state", () => {
    expect(() =>
      assertCatalogReadModelIntegrity({
        contradictoryStockCount: 3,
        unknownStockCount: 0,
      })
    ).toThrow("3 published product(s) are marked sold out")
  })

  it("rejects unresolved published stock state", () => {
    expect(() =>
      assertCatalogReadModelIntegrity({
        contradictoryStockCount: 0,
        unknownStockCount: 2,
      })
    ).toThrow("2 published product(s) have unknown stock")
  })
})
