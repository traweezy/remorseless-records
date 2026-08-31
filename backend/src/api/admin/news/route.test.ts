import { GET } from "./route"

const entry = (overrides: Record<string, unknown> = {}) => ({
  archived_at: null,
  author: "Ada Admin",
  content: "<p>Update</p>",
  cover_alt_text: null,
  cover_url: null,
  created_at: "2026-08-01T00:00:00.000Z",
  excerpt: null,
  id: "news_1",
  published_at: null,
  seo_description: null,
  seo_title: null,
  slug: "update",
  status: "draft",
  tags: [],
  title: "Update",
  updated_at: "2026-08-02T00:00:00.000Z",
  version: 1,
  ...overrides,
})

const request = (listAndCountNewsEntries: jest.Mock) => ({
  query: {},
  scope: { resolve: jest.fn(() => ({ listAndCountNewsEntries })) },
})

describe("GET /admin/news", () => {
  it("returns a validated counted content page", async () => {
    const listAndCountNewsEntries = jest.fn().mockResolvedValue([[entry()], 1])
    const json = jest.fn()
    const status = jest.fn().mockReturnValue({ json })

    await GET(request(listAndCountNewsEntries) as never, { status } as never)

    expect(status).toHaveBeenCalledWith(200)
    expect(json).toHaveBeenCalledWith({
      count: 1,
      entries: [expect.objectContaining({ id: "news_1", slug: "update" })],
      limit: 25,
      offset: 0,
    })
  })

  it("rejects a primitive row before Admin serialization", async () => {
    const listAndCountNewsEntries = jest.fn().mockResolvedValue([[false], 1])

    await expect(
      GET(request(listAndCountNewsEntries) as never, {} as never)
    ).rejects.toThrow(
      "The Admin content persistence boundary returned invalid structured data."
    )
  })
})
