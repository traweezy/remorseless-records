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
})
