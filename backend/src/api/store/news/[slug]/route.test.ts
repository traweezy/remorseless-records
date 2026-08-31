import { GET } from "./route"

const entry = (overrides: Record<string, unknown> = {}) => ({
  archived_at: null,
  author: null,
  content: "<p>Update</p>",
  cover_alt_text: null,
  cover_url: null,
  created_at: "2026-08-01T00:00:00.000Z",
  excerpt: null,
  id: "news_1",
  published_at: "2026-08-02T00:00:00.000Z",
  seo_description: null,
  seo_title: null,
  slug: "update",
  status: "published",
  tags: [],
  title: "Update",
  updated_at: "2026-08-02T00:00:00.000Z",
  version: 1,
  ...overrides,
})

const request = (listNewsEntries: jest.Mock, slug = "update") => ({
  params: { slug },
  scope: { resolve: jest.fn(() => ({ listNewsEntries })) },
})

describe("GET /store/news/:slug", () => {
  it("returns the exact validated public entry", async () => {
    const listNewsEntries = jest.fn().mockResolvedValue([entry()])
    const json = jest.fn()
    const status = jest.fn().mockReturnValue({ json })

    await GET(request(listNewsEntries) as never, { status } as never)

    expect(status).toHaveBeenCalledWith(200)
    expect(json).toHaveBeenCalledWith({
      entry: expect.objectContaining({ id: "news_1", slug: "update" }),
    })
  })

  it("keeps an empty exact result as not found", async () => {
    const listNewsEntries = jest.fn().mockResolvedValue([])

    await expect(
      GET(request(listNewsEntries) as never, {} as never)
    ).rejects.toThrow("News entry not found")
  })

  it("rejects an ambiguous exact-slug persistence result", async () => {
    const listNewsEntries = jest
      .fn()
      .mockResolvedValue([entry(), entry({ id: "news_2" })])

    await expect(
      GET(request(listNewsEntries) as never, {} as never)
    ).rejects.toThrow(
      "The Store module projection returned invalid structured data."
    )
  })
})
