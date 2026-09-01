import { describe, expect, it } from "vitest"

import { parseNewsEntryResponse, parseNewsListResponse } from "./contract"

const entryFixture = () => ({
  id: "news_01",
  title: "Release update",
  slug: "release-update",
  excerpt: null,
  content: "<p>Update</p>",
  author: null,
  status: "published",
  publishedAt: "2026-09-01T10:00:00.000Z",
  tags: ["release"],
  coverUrl: null,
  coverAltText: null,
  seoTitle: null,
  seoDescription: null,
  version: 1,
  archivedAt: null,
  createdAt: "2026-09-01T09:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
})

describe("news response contract", () => {
  it("projects known fields and discards persistence metadata", () => {
    const response = parseNewsEntryResponse({ entry: entryFixture() })

    expect(response.entry).toMatchObject({
      id: "news_01",
      slug: "release-update",
      tags: ["release"],
    })
    expect(response.entry).not.toHaveProperty("version")
    expect(response.entry).not.toHaveProperty("archivedAt")
  })

  it("rejects duplicate identities and inconsistent pagination", () => {
    const entry = entryFixture()
    expect(() =>
      parseNewsListResponse(
        { entries: [entry, entry], count: 2, limit: 2, offset: 0 },
        { limit: 2, offset: 0 }
      )
    ).toThrow("duplicate")
    expect(() =>
      parseNewsListResponse(
        { entries: [entry], count: 1, limit: 6, offset: 1 },
        { limit: 6, offset: 0 }
      )
    ).toThrow("pagination")
  })

  it("rejects malformed timestamps, status, and unknown fields", () => {
    expect(() =>
      parseNewsEntryResponse({
        entry: {
          ...entryFixture(),
          publishedAt: "not-a-timestamp",
        },
      })
    ).toThrow()
    expect(() =>
      parseNewsEntryResponse({
        entry: { ...entryFixture(), status: "draft" },
      })
    ).toThrow()
    expect(() =>
      parseNewsEntryResponse({
        entry: { ...entryFixture(), providerSecret: "must-not-pass" },
      })
    ).toThrow()
  })
})
