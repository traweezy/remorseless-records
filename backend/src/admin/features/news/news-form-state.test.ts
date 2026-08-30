import {
  buildNewsWriteInput,
  newsEditorDraftSchema,
  newsEditorValidationIssues,
  newsEditorSchema,
  newsEntryMatchesWriteInput,
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

  it("maps invalid fields to stable editor targets while allowing draft recovery", () => {
    const incomplete = { ...values(), content: "", title: "" }
    expect(newsEditorDraftSchema.safeParse(incomplete).success).toBe(true)
    expect(newsEditorValidationIssues(incomplete)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetId: "news-content" }),
        expect.objectContaining({ targetId: "news-title" }),
      ]),
    )
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

  it("compares a persisted response with its intended write", () => {
    const input = buildNewsWriteInput(values(), "draft")
    const persisted: NewsEntry = {
      archivedAt: null,
      author: "Admin User",
      content: input.content,
      coverAltText: input.coverAltText,
      coverUrl: input.coverUrl,
      excerpt: input.excerpt,
      id: "news-entry-one",
      publishedAt: input.publishedAt,
      seoDescription: null,
      seoTitle: null,
      slug: "label-update",
      status: input.status,
      tags: input.tags,
      title: input.title,
      version: 2,
    }
    expect(newsEntryMatchesWriteInput(persisted, input)).toBe(true)
    expect(
      newsEntryMatchesWriteInput(
        { ...persisted, title: "Different title" },
        input,
      ),
    ).toBe(false)
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
