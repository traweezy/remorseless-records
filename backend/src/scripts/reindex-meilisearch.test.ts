import { assertTaskSucceeded } from "./reindex-meilisearch"

describe("assertTaskSucceeded", () => {
  it("accepts a completed Meilisearch task", () => {
    expect(() =>
      assertTaskSucceeded({ status: "succeeded" }, "catalog batch")
    ).not.toThrow()
  })

  it("rejects failed and canceled Meilisearch tasks", () => {
    expect(() =>
      assertTaskSucceeded(
        { status: "failed", error: { message: "bad document" } },
        "catalog batch"
      )
    ).toThrow("catalog batch failed")
    expect(() =>
      assertTaskSucceeded({ status: "canceled" }, "catalog batch")
    ).toThrow("catalog batch canceled")
  })
})
