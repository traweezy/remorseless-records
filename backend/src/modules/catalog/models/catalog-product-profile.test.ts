import CatalogProductProfile from "./catalog-product-profile"

describe("catalog product profile model", () => {
  it("keeps the tracklist JSON default as an empty array", () => {
    const property = CatalogProductProfile.schema.tracklist.parse("tracklist")

    expect(Array.isArray(property.defaultValue)).toBe(true)
    expect(Object.getPrototypeOf(property.defaultValue)).toBe(Array.prototype)
    expect(JSON.stringify(property.defaultValue)).toBe("[]")
  })
})
