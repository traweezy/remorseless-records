import { hashCatalogCommand } from "./catalog-command"

describe("catalog command hashing", () => {
  it("is stable across object key order", () => {
    expect(hashCatalogCommand({ b: 2, a: { d: 4, c: 3 } })).toBe(
      hashCatalogCommand({ a: { c: 3, d: 4 }, b: 2 })
    )
  })

  it("preserves array order because it is part of command intent", () => {
    expect(hashCatalogCommand({ items: ["a", "b"] })).not.toBe(
      hashCatalogCommand({ items: ["b", "a"] })
    )
  })
})
