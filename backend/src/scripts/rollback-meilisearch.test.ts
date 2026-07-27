import { assertRollbackConfirmation } from "./rollback-meilisearch"

describe("assertRollbackConfirmation", () => {
  it("requires the exact controlled rollback UID", () => {
    expect(() =>
      assertRollbackConfirmation({
        confirmation: "products_build_20260727t001742238z_local",
        rollbackIndex: "products_build_20260727t001742238z_local",
      })
    ).not.toThrow()
  })

  it("rejects a missing or mismatched confirmation", () => {
    expect(() =>
      assertRollbackConfirmation({
        confirmation: "",
        rollbackIndex: "products_build_20260727t001742238z_local",
      })
    ).toThrow("MEILISEARCH_ROLLBACK_CONFIRM")
  })
})
