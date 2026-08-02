import { withStableDiscographyOrder } from "./list-order"

describe("discography list ordering", () => {
  it("appends a stable id tie-breaker after caller sort fields", () => {
    expect(
      Object.entries(
        withStableDiscographyOrder({
          release_year: "DESC",
          release_date: "DESC",
          created_at: "DESC",
        })
      )
    ).toEqual([
      ["release_year", "DESC"],
      ["release_date", "DESC"],
      ["created_at", "DESC"],
      ["id", "ASC"],
    ])
  })

  it("preserves an explicit id direction", () => {
    expect(withStableDiscographyOrder({ id: "DESC" })).toEqual({ id: "DESC" })
  })
})
