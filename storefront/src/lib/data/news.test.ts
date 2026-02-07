import { faker } from "@faker-js/faker"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("news data layer", () => {
  beforeEach(() => {
    faker.seed(1801)
  })

  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it("fetches news list and normalizes entry fields", async () => {
    const backendUrl = faker.internet.url()
    const publishableKey = faker.string.alphanumeric(16)
    const id = faker.string.uuid()
    const title = faker.lorem.words(2)
    const slug = faker.helpers.slugify(title).toLowerCase()
    const publishedAt = faker.date.past().toISOString()
    const createdAt = faker.date.past().toISOString()
    const updatedAt = faker.date.recent().toISOString()

    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/config/env", () => ({
      runtimeEnv: {
        medusaBackendUrl: backendUrl,
        medusaPublishableKey: publishableKey,
      },
    }))

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
        entries: [
          {
            id,
            title,
            slug,
            excerpt: "  Excerpt  ",
            content: "<p>Content</p>",
            author: "  Admin ",
            status: "published",
            publishedAt: ` ${publishedAt} `,
            tags: ["news"],
            coverUrl: " https://cdn.example.com/news.jpg ",
            seoTitle: " SEO ",
            seoDescription: " Description ",
            createdAt: ` ${createdAt} `,
            updatedAt: ` ${updatedAt} `,
          },
        ],
        count: 1,
        offset: 0,
        limit: 6,
        }),
    } as Response)

    const { fetchNewsEntries } = await import("@/lib/data/news")
    const response = await fetchNewsEntries({ limit: 6, offset: 0 })
    expect(response.count).toBe(1)
    expect(response.entries[0]).toMatchObject({
      id,
      title,
      slug,
      excerpt: "Excerpt",
      author: "Admin",
      seoTitle: "SEO",
      seoDescription: "Description",
      publishedAt,
      createdAt,
      updatedAt,
    })
  })

  it("fetches a single entry by slug and handles 404", async () => {
    const backendUrl = faker.internet.url()
    const publishableKey = faker.string.alphanumeric(18)
    const id = faker.string.uuid()
    const title = faker.lorem.words(2)
    const slug = faker.helpers.slugify(title).toLowerCase()

    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/config/env", () => ({
      runtimeEnv: {
        medusaBackendUrl: backendUrl,
        medusaPublishableKey: publishableKey,
      },
    }))

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
          entry: {
            id,
            title,
            slug,
            excerpt: null,
            content: "<p>Body</p>",
            author: null,
            status: "published",
            publishedAt: null,
            coverUrl: null,
            seoTitle: null,
            seoDescription: null,
          },
          }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response)

    const { fetchNewsEntryBySlug, getNewsEntryBySlug } = await import("@/lib/data/news")
    await expect(fetchNewsEntryBySlug(slug)).resolves.toMatchObject({ slug })
    await expect(getNewsEntryBySlug("missing")).resolves.toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("uses payload defaults when count/offset/limit are absent", async () => {
    const backendUrl = faker.internet.url()
    const publishableKey = faker.string.alphanumeric(16)
    const offset = faker.number.int({ min: 5, max: 25 })
    const limit = faker.number.int({ min: 3, max: 9 })

    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/config/env", () => ({
      runtimeEnv: {
        medusaBackendUrl: backendUrl,
        medusaPublishableKey: publishableKey,
      },
    }))
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          entries: [],
        }),
    } as Response)

    const { fetchNewsEntries } = await import("@/lib/data/news")
    const response = await fetchNewsEntries({ limit, offset })
    expect(response).toEqual({
      entries: [],
      count: 0,
      offset,
      limit,
    })
  })

  it("returns null for blank slug and logs non-404 errors", async () => {
    const backendUrl = faker.internet.url()
    const publishableKey = faker.string.alphanumeric(16)

    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/config/env", () => ({
      runtimeEnv: {
        medusaBackendUrl: backendUrl,
        medusaPublishableKey: publishableKey,
      },
    }))

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: faker.number.int({ min: 500, max: 599 }),
    } as Response)

    const { fetchNewsEntryBySlug, getNewsEntryBySlug, fetchNewsEntries } = await import(
      "@/lib/data/news"
    )
    await expect(fetchNewsEntryBySlug("   ")).resolves.toBeNull()
    await expect(getNewsEntryBySlug("   ")).resolves.toBeNull()
    await expect(fetchNewsEntries({ limit: 5, offset: 0 })).resolves.toEqual({
      entries: [],
      count: 0,
      offset: 0,
      limit: 5,
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalled()
  })
})
