import { buildStoreNewsFilters } from "./store-visibility"

describe("news storefront visibility", () => {
  it("includes only due published or scheduled posts that are not archived", () => {
    const now = new Date("2026-08-02T07:00:00.000Z")
    expect(buildStoreNewsFilters(now)).toEqual({
      archived_at: null,
      published_at: { $lte: now },
      status: { $in: ["published", "scheduled"] },
    })
  })
})
