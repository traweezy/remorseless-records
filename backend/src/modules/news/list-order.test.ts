import { withStableNewsOrder } from "./list-order"

describe("stable news ordering", () => {
  it("adds an ascending id tie-breaker", () => {
    expect(
      withStableNewsOrder({ published_at: "DESC", created_at: "DESC" })
    ).toEqual({
      published_at: "DESC",
      created_at: "DESC",
      id: "ASC",
    })
  })

  it("preserves an explicit id order", () => {
    expect(withStableNewsOrder({ id: "DESC" })).toEqual({ id: "DESC" })
  })
})
