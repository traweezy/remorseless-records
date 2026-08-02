import {
  buildNewsWriteInput,
  newsEditorSchema,
  splitNewsTags,
  validatePublicationIntent,
  valuesFromNewsEntry,
  type NewsEditorValues,
} from "./news-form-state"
import type { NewsEntry } from "./news-query"

const values = (): NewsEditorValues => ({
  content: "<p>Label update content.</p>",
  coverAltText: "",
  coverUrl: "",
  excerpt: " A label update. ",
  scheduleAt: "",
  tagsText: "Update, Releases, update",
  title: " Label update ",
})

describe("News editor state", () => {
  it("requires visible content and accessible cover copy", () => {
    expect(newsEditorSchema.safeParse({ ...values(), content: "<p> </p>" }).success).toBe(false)
    expect(
      newsEditorSchema.safeParse({
        ...values(),
        coverUrl: "https://cdn.example.com/cover.jpg",
      }).success,
    ).toBe(false)
    expect(
      newsEditorSchema.safeParse({
        ...values(),
        coverAltText: "A studio mixing desk",
        coverUrl: "ftp://cdn.example.com/cover.jpg",
      }).success,
    ).toBe(false)
  })

  it("deduplicates normalized tags", () => {
    expect(splitNewsTags("Update, Releases\nupdate,  ")).toEqual([
      "Update",
      "Releases",
    ])
  })

  it("builds distinct draft, schedule, and publish commands", () => {
    const draftValues = values()
    const future = new Date(Date.now() + 86_400_000)
    const scheduledValues = {
      ...draftValues,
      scheduleAt: future.toISOString().slice(0, 16),
    }

    expect(buildNewsWriteInput(draftValues, "draft")).toMatchObject({
      publishedAt: null,
      status: "draft",
      tags: ["Update", "Releases"],
    })
    expect(buildNewsWriteInput(scheduledValues, "schedule")).toMatchObject({
      publishedAt: expect.any(String),
      status: "scheduled",
    })
    expect(buildNewsWriteInput(scheduledValues, "publish")).toMatchObject({
      publishedAt: null,
      status: "published",
    })
  })

  it("rejects missing and past schedule times", () => {
    const now = new Date("2030-01-02T12:00:00.000Z")
    expect(validatePublicationIntent(values(), "schedule", now)).toMatch("Choose")
    expect(
      validatePublicationIntent(
        { ...values(), scheduleAt: "2030-01-01T12:00" },
        "schedule",
        now,
      ),
    ).toMatch("future")
  })

  it("maps scheduled entries back into editable local time", () => {
    const entry = {
      archivedAt: null,
      author: "Admin User",
      content: "<p>Label update content.</p>",
      coverAltText: null,
      coverUrl: null,
      excerpt: null,
      id: "news-entry-one",
      publishedAt: "2031-05-06T14:30:00.000Z",
      seoDescription: null,
      seoTitle: null,
      slug: "label-update",
      status: "scheduled",
      tags: [],
      title: "Label update",
      version: 1,
    } satisfies NewsEntry

    expect(valuesFromNewsEntry(entry).scheduleAt).toHaveLength(16)
  })
})
