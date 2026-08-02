import {
  serializeDiscographyEntry,
  type DiscographyEntryRecord,
} from "./serializers"

const linkedEntry = {
  album: "Release",
  artist: "Artist",
  availability: "in_print",
  catalog_number: null,
  collection_title: null,
  cover_alt_text: null,
  cover_url: null,
  formats: [],
  genres: [],
  id: "disc_linked",
  product_handle: "stale-handle",
  product_id: "prod_linked",
  release_date: null,
  release_year: 2026,
  source_mode: "catalog_product",
  tags: [],
  title: "Release",
  updated_at: "2026-08-02T05:00:00.000Z",
  version: 1,
} satisfies DiscographyEntryRecord

describe("discography serialization", () => {
  it("uses only a current published product handle for customer links", () => {
    expect(
      serializeDiscographyEntry(linkedEntry, {
        product: { handle: "current-handle", status: "published" },
      })
    ).toMatchObject({
      linkHealth: "healthy",
      productHandle: "current-handle",
    })
    expect(
      serializeDiscographyEntry(linkedEntry, { product: null })
    ).toMatchObject({ linkHealth: "missing", productHandle: null })
    expect(
      serializeDiscographyEntry(linkedEntry, {
        product: { handle: "draft-handle", status: "draft" },
      })
    ).toMatchObject({ linkHealth: "unpublished", productHandle: null })
  })
})
