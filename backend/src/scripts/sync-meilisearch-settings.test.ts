import {
  assertConfiguredIndexSettings,
  normalizeAttributeList,
} from "./sync-meilisearch-settings"

describe("Meilisearch settings validation", () => {
  it("normalizes string and object filter definitions", () => {
    expect(
      normalizeAttributeList([
        "status",
        { attribute: "price_min", features: { facetSearch: true } },
        null,
      ])
    ).toEqual(["status", "price_min"])
  })

  it("accepts the exact configured settings", () => {
    expect(() =>
      assertConfiguredIndexSettings({
        actual: {
          filterableAttributes: ["price_min", "status"],
          rankingRules: ["words", "exactness"],
          searchableAttributes: ["title", "artist"],
          typoTolerance: {
            disableOnAttributes: [],
            enabled: true,
            minWordSizeForTypos: { oneTypo: 5, twoTypos: 9 },
          },
        },
        expected: {
          filterableAttributes: ["status", "price_min"],
          rankingRules: ["words", "exactness"],
          searchableAttributes: ["title", "artist"],
          typoTolerance: {
            enabled: true,
            minWordSizeForTypos: { oneTypo: 5, twoTypos: 9 },
          },
        },
        indexKey: "products_build_test",
      })
    ).not.toThrow()
  })

  it("rejects extra searchable fields and changed typo settings", () => {
    expect(() =>
      assertConfiguredIndexSettings({
        actual: {
          searchableAttributes: ["title", "artist", "description"],
          typoTolerance: { enabled: false },
        },
        expected: {
          searchableAttributes: ["title", "artist"],
          typoTolerance: { enabled: true },
        },
        indexKey: "products_build_test",
      })
    ).toThrow("searchableAttributes")
  })
})
