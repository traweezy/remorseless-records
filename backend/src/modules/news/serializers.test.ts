import {
  serializeNewsEntry,
  serializeStoreNewsEntry,
  type NewsEntryRecord,
} from "./serializers"

const record = (overrides: Partial<NewsEntryRecord> = {}): NewsEntryRecord => ({
  archived_at: null,
  author: "Remorseless Records",
  content: "<p>Safe body</p>",
  cover_alt_text: "Black and red cover artwork",
  cover_url: "https://cdn.example.com/news.jpg",
  created_at: new Date("2026-08-02T06:00:00.000Z"),
  excerpt: "Update",
  id: "news_1",
  published_at: new Date("2026-08-02T07:00:00.000Z"),
  seo_description: "Update",
  seo_title: "Update · Remorseless Records",
  slug: "update",
  status: "scheduled",
  tags: ["Studio"],
  title: "Update",
  updated_at: new Date("2026-08-02T06:30:00.000Z"),
  version: 2,
  ...overrides,
})

describe("news serializer", () => {
  it("exposes lifecycle, cover semantics, and ISO timestamps", () => {
    expect(serializeNewsEntry(record())).toMatchObject({
      archivedAt: null,
      coverAltText: "Black and red cover artwork",
      createdAt: "2026-08-02T06:00:00.000Z",
      publishedAt: "2026-08-02T07:00:00.000Z",
      status: "scheduled",
      updatedAt: "2026-08-02T06:30:00.000Z",
      version: 2,
    })
  })

  it("derives archived status and re-sanitizes stored rich text", () => {
    const serialized = serializeNewsEntry(
      record({
        archived_at: new Date("2026-08-02T08:00:00.000Z"),
        content: "<p>Visible</p><script>alert(1)</script>",
        status: "published",
      })
    )
    expect(serialized).toMatchObject({
      archivedAt: "2026-08-02T08:00:00.000Z",
      content: "<p>Visible</p>",
      status: "archived",
    })
  })

  it("normalizes a due scheduled post to the customer-facing published state", () => {
    expect(serializeStoreNewsEntry(record())).toMatchObject({
      archivedAt: null,
      status: "published",
    })
  })
})
