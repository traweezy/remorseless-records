import {
  coerceCatalogJsonList,
  coerceCatalogJsonRecord,
  normalizeCatalogList,
  slugifyCatalogValue,
  toCatalogNullableString,
  toCatalogOptionalDate,
  toCatalogOptionalInteger,
} from "./normalization"

describe("catalog normalization", () => {
  it("normalizes human labels without leaking punctuation or accents", () => {
    expect(slugifyCatalogValue("  Déjà Vu — 12″  ")).toBe("deja-vu-12")
    expect(slugifyCatalogValue("...!", "fallback")).toBe("fallback")
  })

  it("trims lists and nullable text", () => {
    expect(normalizeCatalogList([" Vinyl ", "", "  ", "CD"])).toEqual([
      "Vinyl",
      "CD",
    ])
    expect(toCatalogNullableString("  value  ")).toBe("value")
    expect(toCatalogNullableString("   ")).toBeNull()
    expect(toCatalogNullableString(42)).toBeNull()
  })

  it("rejects invalid dates and non-integer numeric values", () => {
    expect(toCatalogOptionalDate("2026-07-26")?.toISOString()).toBe(
      "2026-07-26T00:00:00.000Z",
    )
    expect(toCatalogOptionalDate("not-a-date")).toBeNull()
    expect(toCatalogOptionalInteger(5)).toBe(5)
    expect(toCatalogOptionalInteger(5.5)).toBeNull()
  })

  it("keeps only the expected JSON container shape", () => {
    expect(coerceCatalogJsonRecord({ nested: true })).toEqual({
      nested: true,
    })
    expect(coerceCatalogJsonRecord(["not", "a", "record"])).toEqual({})
    expect(coerceCatalogJsonList(["item"])).toEqual(["item"])
    expect(coerceCatalogJsonList({ item: true })).toEqual([])
  })
})
