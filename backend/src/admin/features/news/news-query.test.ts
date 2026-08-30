import { requestAdminJson } from "../../lib/admin-request"
import {
  createNewsEntry,
  getNewsEntry,
  listNewsEntries,
  updateNewsEntry,
  updateNewsLifecycle,
  type NewsEntry,
  type NewsWriteInput,
} from "./news-query"

jest.mock("../../lib/admin-request", () => ({
  requestAdminJson: jest.fn(),
}))

const requestMock = jest.mocked(requestAdminJson)

const entry = (): NewsEntry => ({
  archivedAt: null,
  author: "Admin User",
  content: "<p>Label update content.</p>",
  coverAltText: null,
  coverUrl: null,
  createdAt: "2030-01-01T00:00:00.000Z",
  excerpt: "A label update.",
  id: "news-entry-one",
  publishedAt: null,
  seoDescription: "A label update.",
  seoTitle: "Label update",
  slug: "label-update",
  status: "draft",
  tags: ["Update"],
  title: "Label update",
  updatedAt: "2030-01-02T00:00:00.000Z",
  version: 2,
})

const writeInput = (): NewsWriteInput => ({
  content: "<p>Label update content.</p>",
  coverAltText: null,
  coverUrl: null,
  excerpt: null,
  publishedAt: null,
  status: "draft",
  tags: [],
  title: "Label update",
})

describe("news Admin query boundary", () => {
  beforeEach(() => {
    requestMock.mockReset()
    requestMock.mockResolvedValue({} as never)
  })

  it("sends stable server-side collection controls", async () => {
    const signal = new AbortController().signal
    await listNewsEntries(
      {
        archived: "active",
        direction: "desc",
        limit: 25,
        offset: 50,
        order: "updated_at",
        q: "  release update  ",
        status: "scheduled",
      },
      signal,
    )

    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/admin/news",
        query: {
          archived: "active",
          direction: "desc",
          limit: 25,
          offset: 50,
          order: "updated_at",
          q: "release update",
          status: "scheduled",
        },
        signal,
      }),
    )
  })

  it("omits blank search and the all-status sentinel", async () => {
    await listNewsEntries({
      archived: "archived",
      direction: "asc",
      limit: 25,
      offset: 0,
      order: "title",
      q: "  ",
      status: "all",
    })

    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          archived: "archived",
          direction: "asc",
          limit: 25,
          offset: 0,
          order: "title",
        },
      }),
    )
  })

  it("loads one post through the validated detail boundary", async () => {
    requestMock.mockResolvedValueOnce({ entry: entry() } as never)

    await expect(getNewsEntry("news/one")).resolves.toEqual(entry())
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/admin/news/news%2Fone" }),
    )
  })

  it("carries idempotency and optimistic versions through mutations", async () => {
    const current = entry()
    const input = writeInput()
    const createKey = crypto.randomUUID()
    const updateKey = crypto.randomUUID()
    const lifecycleKey = crypto.randomUUID()

    await createNewsEntry(input, createKey)
    await updateNewsEntry(current, input, updateKey)
    await updateNewsLifecycle(current, "archive", lifecycleKey)

    expect(requestMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        body: expect.objectContaining({
          expectedVersion: 0,
          idempotencyKey: createKey,
        }),
        method: "POST",
        path: "/admin/news",
      }),
    )
    expect(requestMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        body: expect.objectContaining({
          expectedVersion: current.version,
          idempotencyKey: updateKey,
        }),
        method: "PUT",
        path: `/admin/news/${current.id}`,
      }),
    )
    expect(requestMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        body: {
          expectedVersion: current.version,
          idempotencyKey: lifecycleKey,
        },
        method: "POST",
        path: `/admin/news/${current.id}/archive`,
      }),
    )
  })
})
