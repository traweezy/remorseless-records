import { renderToStaticMarkup } from "react-dom/server"

import { savedNewsCommandSchema } from "./news-command-state"
import { NewsCommandReview } from "./news-command-review"

const request = () =>
  savedNewsCommandSchema.parse({
    version: 1,
    context: {
      backendOrigin: "https://admin.example.test",
      entryId: "news_owned",
    },
    loadedEntry: {
      id: "news_owned",
      version: 3,
      archivedAt: null,
      author: "Owned author",
      content: "<p>Owned story</p>",
      coverAltText: null,
      coverUrl: null,
      excerpt: null,
      publishedAt: null,
      seoDescription: null,
      seoTitle: null,
      slug: "owned-story",
      status: "draft",
      tags: [],
      title: "Owned headline",
    },
    intent: "publish",
    body: {
      expectedActorId: "user_original",
      expectedVersion: 3,
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
      content: "<p>Owned story</p>",
      title: "Owned headline",
      coverAltText: null,
      coverUrl: null,
      excerpt: null,
      publishedAt: null,
      status: "published",
      tags: [],
    },
    status: "uncertain",
    acknowledgement: null,
  })
const render = (
  record = request(),
  canRetry = true,
  error: string | null = null
) =>
  renderToStaticMarkup(
    <NewsCommandReview
      record={record}
      canRetry={canRetry}
      busy={false}
      error={error}
      onRetry={() => {}}
      onResolve={() => {}}
    />
  )

describe("News saved-command feedback", () => {
  it("states uncertainty without claiming nothing saved and renders the immutable request", () => {
    const markup = render(request(), true, "The retry was rejected")
    expect(markup).toContain("News save unconfirmed")
    expect(markup).toContain("may already have saved")
    expect(markup).not.toContain("Nothing has been saved")
    expect(markup).not.toContain("Changes were not saved")
    expect(markup).toContain("00000000-0000-4000-8000-000000000001")
    expect(markup).toContain("server-assigned publication time")
    expect(markup).toContain("&lt;p&gt;Owned story&lt;/p&gt;")
    expect(markup).toContain("The retry was rejected")
    expect(markup).toContain("Retry saved News request")
  })
  it("retains the request while making retry unavailable without update permission", () => {
    const markup = render(request(), false)
    expect(markup).toMatch(
      /<button[^>]*disabled=""[^>]*>Retry saved News request/
    )
    expect(markup).toContain("News update permission is required")
    expect(markup).not.toContain("Clear rejected request")
  })
  it("distinguishes a definitive first rejection from uncertainty", () => {
    const markup = render({ ...request(), status: "rejected" })
    expect(markup).toContain("The first request was rejected")
    expect(markup).toContain("Clear rejected request")
    expect(markup).not.toContain("Retry saved News request")
  })
  it("describes confirmed results as historical rather than the current post", () => {
    const saved = request()
    const markup = render(
      savedNewsCommandSchema.parse({
        ...saved,
        status: "confirmed",
        acknowledgement: {
          replayed: true,
          entry: {
            ...saved.loadedEntry,
            version: 4,
            status: "published",
            publishedAt: "2030-01-01T00:00:00.000Z",
            seoTitle: "Owned headline · Remorseless Records",
            seoDescription: "Owned story",
          },
        },
      })
    )
    expect(markup).toContain("historical acknowledgement")
    expect(markup).toContain("current post may have changed")
    expect(markup).toContain("Finish confirmed save")
    expect(markup).not.toContain("Retry saved News request")
  })
})
