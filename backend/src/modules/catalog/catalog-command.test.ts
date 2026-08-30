import {
  deriveCatalogCommandIdempotencyKey,
  hashCatalogCommand,
} from "./catalog-command"

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

  it("derives stable, isolated UUID keys for nested commands", () => {
    const parent = "00000000-0000-4000-8000-000000000001"
    const profileKey = deriveCatalogCommandIdempotencyKey(parent, "profile")

    expect(profileKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
    expect(deriveCatalogCommandIdempotencyKey(parent, "profile")).toBe(
      profileKey
    )
    expect(deriveCatalogCommandIdempotencyKey(parent, "variant:0")).not.toBe(
      profileKey
    )
  })
})
