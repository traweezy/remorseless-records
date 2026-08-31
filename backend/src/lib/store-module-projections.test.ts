import {
  readStoreDiscographyPage,
  readStoreNewsDetail,
  readStoreNewsPage,
  readStoreShelfMemberships,
  readStoreShelfPage,
  readStoreShelfProductProfiles,
} from "./store-module-projections"

const INVALID_PROJECTION =
  "The Store module projection returned invalid structured data."
const now = new Date("2026-08-30T12:00:00.000Z")

const discographyEntry = (): Record<string, unknown> => ({
  album: "Release",
  archived_at: null,
  artist: "Artist",
  availability: "in_print",
  catalog_number: "RR-001",
  collection_title: "Collection",
  cover_alt_text: "Release artwork",
  cover_url: "https://media.example/release.jpg",
  created_at: "2026-08-01T00:00:00.000Z",
  formats: ["Vinyl"],
  genres: ["Metal"],
  id: "disc_1",
  product_handle: "release",
  product_id: "prod_1",
  release_date: "2026-08-01T00:00:00.000Z",
  release_year: 2026,
  source_mode: "catalog_product",
  tags: ["Featured"],
  title: "Release",
  updated_at: "2026-08-02T00:00:00.000Z",
  version: 2,
})

const shelf = (): Record<string, unknown> => ({
  archived_at: null,
  automation_type: "new_release",
  created_at: "2026-08-01T00:00:00.000Z",
  description: "Recent releases",
  ends_at: null,
  handle: "new-releases",
  id: "cshelf_1",
  is_active: true,
  metadata: { ignored: "private", lookback_days: 45 },
  mode: "automatic",
  product_limit: 12,
  ribbon_label: "New",
  ribbon_priority: 1,
  show_ribbon: true,
  starts_at: null,
  title: "New releases",
  updated_at: "2026-08-02T00:00:00.000Z",
  version: 3,
})

const membership = (): Record<string, unknown> => ({
  created_at: "2026-08-01T00:00:00.000Z",
  ends_at: null,
  id: "cshelfp_1",
  is_pinned: true,
  metadata: { internal: true },
  product_id: "prod_1",
  product_profile_id: "cprof_1",
  shelf_id: "cshelf_1",
  sort_order: 0,
  starts_at: null,
  updated_at: "2026-08-02T00:00:00.000Z",
})

const profile = (): Record<string, unknown> => ({
  id: "cprof_1",
  metadata: {
    private_note: "hidden",
    sourceCreatedAt: "2026-07-31T00:00:00.000Z",
  },
  product_id: "prod_1",
  release_date: "2026-08-01T00:00:00.000Z",
})

const newsEntry = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  archived_at: null,
  author: "Remorseless Records",
  content: "<p>Update</p>",
  cover_alt_text: "News artwork",
  cover_url: "https://media.example/news.jpg",
  created_at: "2026-08-01T00:00:00.000Z",
  excerpt: "Update",
  id: "news_1",
  published_at: "2026-08-02T00:00:00.000Z",
  seo_description: "Update",
  seo_title: "Update",
  slug: "update",
  status: "published",
  tags: ["Studio"],
  title: "Update",
  updated_at: "2026-08-02T00:00:00.000Z",
  version: 1,
  ...overrides,
})

describe("Store module projections", () => {
  it("accepts a counted discography page with coherent catalog linkage", () => {
    expect(readStoreDiscographyPage([[discographyEntry()], 3])).toMatchObject({
      count: 3,
      records: [
        {
          id: "disc_1",
          product_handle: "release",
          product_id: "prod_1",
          release_date: "2026-08-01T00:00:00.000Z",
        },
      ],
    })
  })

  it.each([
    ["an invalid counted page", [[discographyEntry()], 0]],
    [
      "a catalog row without a Product",
      [[{ ...discographyEntry(), product_id: null }], 1],
    ],
    [
      "an inconsistent release year",
      [[{ ...discographyEntry(), release_year: 2025 }], 1],
    ],
    [
      "duplicate list values",
      [[{ ...discographyEntry(), formats: ["Vinyl", "Vinyl"] }], 1],
    ],
  ])("rejects %s", (_label, value) => {
    expect(() => readStoreDiscographyPage(value)).toThrow(INVALID_PROJECTION)
  })

  it("projects only public shelf automation metadata", () => {
    const page = readStoreShelfPage([[shelf()], 1])
    const memberships = readStoreShelfMemberships(
      [membership()],
      page.records.map((record) => record.id)
    )
    const profiles = readStoreShelfProductProfiles([profile()])

    expect(page.records[0]?.metadata).toEqual({ lookbackDays: 45 })
    expect(memberships[0]?.metadata).toEqual({})
    expect(profiles[0]?.metadata).toEqual({
      source_created_at: "2026-07-31T00:00:00.000Z",
    })
  })

  it.each([
    ["an inactive shelf", [[{ ...shelf(), is_active: false }], 1]],
    ["an invalid shelf mode", [[{ ...shelf(), mode: "featured" }], 1]],
    [
      "an inverted shelf schedule",
      [
        [
          {
            ...shelf(),
            ends_at: "2026-08-01T00:00:00.000Z",
            starts_at: "2026-08-02T00:00:00.000Z",
          },
        ],
        1,
      ],
    ],
  ])("rejects %s", (_label, value) => {
    expect(() => readStoreShelfPage(value)).toThrow(INVALID_PROJECTION)
  })

  it("rejects memberships outside the requested shelf set", () => {
    expect(() =>
      readStoreShelfMemberships([membership()], ["cshelf_other"])
    ).toThrow(INVALID_PROJECTION)
  })

  it("rejects duplicate shelf profiles for a Product", () => {
    expect(() =>
      readStoreShelfProductProfiles([
        profile(),
        { ...profile(), id: "cprof_2" },
      ])
    ).toThrow(INVALID_PROJECTION)
  })

  it("accepts only due, public news rows and exact detail slugs", () => {
    expect(readStoreNewsPage([[newsEntry()], 1], now)).toMatchObject({
      count: 1,
      records: [{ id: "news_1", slug: "update", status: "published" }],
    })
    expect(readStoreNewsDetail([newsEntry()], "update", now)?.id).toBe("news_1")
    expect(readStoreNewsDetail([], "missing", now)).toBeNull()
  })

  it.each([
    [
      "a future publication",
      [[newsEntry({ published_at: "2026-09-01T00:00:00.000Z" })], 1],
    ],
    ["an archived row", [[newsEntry({ archived_at: now })], 1]],
    ["a malformed URL", [[newsEntry({ cover_url: "javascript:x" })], 1]],
    ["duplicate slugs", [[newsEntry(), newsEntry({ id: "news_2" })], 2]],
  ])("rejects %s", (_label, value) => {
    expect(() => readStoreNewsPage(value, now)).toThrow(INVALID_PROJECTION)
  })

  it("rejects an ambiguous or mismatched news detail result", () => {
    expect(() =>
      readStoreNewsDetail(
        [newsEntry(), newsEntry({ id: "news_2", slug: "other" })],
        "update",
        now
      )
    ).toThrow(INVALID_PROJECTION)
    expect(() => readStoreNewsDetail([newsEntry()], "other", now)).toThrow(
      INVALID_PROJECTION
    )
  })
})
