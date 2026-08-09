import indexSettings from "../../../config/meilisearch-settings.json"

describe("product search settings", () => {
  it("limits free-text search to product and artist names", () => {
    expect(indexSettings.products.indexSettings.searchableAttributes).toEqual([
      "title",
      "release_title",
      "artist_names",
      "artist",
    ])
  })

  it("supports deterministic artist sorting without widening search", () => {
    expect(indexSettings.products.indexSettings.displayedAttributes).toContain(
      "artist_sort"
    )
    expect(indexSettings.products.indexSettings.sortableAttributes).toContain(
      "artist_sort"
    )
    expect(indexSettings.products.indexSettings.sortableAttributes).toContain(
      "id"
    )
  })
})
