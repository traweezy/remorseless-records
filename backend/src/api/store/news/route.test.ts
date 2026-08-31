import { GET } from "./route"

const newsEntry = (overrides: Record<string, unknown> = {}) => ({
  archived_at: null,
  author: "Remorseless Records",
  content: "<p>Visible</p><script>hidden()</script>",
  cover_alt_text: null,
  cover_url: null,
  created_at: "2026-08-01T00:00:00.000Z",
  excerpt: "Update",
  id: "news_1",
  published_at: "2026-08-02T00:00:00.000Z",
  seo_description: null,
  seo_title: null,
  slug: "update",
  status: "scheduled",
  tags: ["Studio"],
  title: "Update",
  updated_at: "2026-08-02T00:00:00.000Z",
  version: 1,
  ...overrides,
})

const request = (listAndCountNewsEntries: jest.Mock) => ({
  query: {},
  scope: {
    resolve: jest.fn(() => ({ listAndCountNewsEntries })),
  },
})

describe("GET /store/news", () => {
  it("returns validated due entries with sanitized public content", async () => {
    const listAndCountNewsEntries = jest
      .fn()
      .mockResolvedValue([[newsEntry()], 1])
    const json = jest.fn()
    const status = jest.fn().mockReturnValue({ json })

    await GET(request(listAndCountNewsEntries) as never, { status } as never)

    expect(status).toHaveBeenCalledWith(200)
    expect(json).toHaveBeenCalledWith({
      count: 1,
      entries: [
        expect.objectContaining({
          archivedAt: null,
          content: "<p>Visible</p>",
          id: "news_1",
          slug: "update",
          status: "published",
        }),
      ],
      limit: 20,
      offset: 0,
    })
  })

  it("rejects a malformed counted persistence result", async () => {
    const listAndCountNewsEntries = jest
      .fn()
      .mockResolvedValue([[newsEntry()], 0])

    await expect(
      GET(request(listAndCountNewsEntries) as never, {} as never)
    ).rejects.toThrow(
      "The Store module projection returned invalid structured data."
    )
  })

  it("rejects future rows returned through the due-entry filter", async () => {
    const listAndCountNewsEntries = jest
      .fn()
      .mockResolvedValue([
        [newsEntry({ published_at: "2200-01-01T00:00:00.000Z" })],
        1,
      ])

    await expect(
      GET(request(listAndCountNewsEntries) as never, {} as never)
    ).rejects.toThrow(
      "The Store module projection returned invalid structured data."
    )
  })
})
