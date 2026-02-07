import { faker } from "@faker-js/faker"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("getDiscographyEntries", () => {
  beforeEach(() => {
    faker.seed(2501)
  })

  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it("normalizes paginated discography entries", async () => {
    const medusaBackendUrl = faker.internet.url()
    const medusaPublishableKey = faker.string.alphanumeric(16)
    const id = faker.string.uuid()
    const artist = faker.person.lastName()
    const album = faker.music.songName()
    const title = `${artist} - ${album}`
    const productHandle = faker.helpers.slugify(`${artist}-${album}`).toLowerCase()
    const releaseDate = faker.date.past().toISOString()
    const releaseYear = new Date(releaseDate).getUTCFullYear()

    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/config/env", () => ({
      runtimeEnv: {
        medusaBackendUrl,
        medusaPublishableKey,
      },
    }))

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
          entries: [
            {
              id,
              title,
              artist,
              album,
              productHandle,
              collectionTitle: faker.company.name(),
              catalogNumber: faker.string.alphanumeric(6).toUpperCase(),
              releaseDate,
              releaseYear: null,
              formats: ["LP", "compact disc"],
              genres: [faker.music.genre()],
              availability: "in_print",
              coverUrl: faker.internet.url(),
            },
          ],
          count: 1,
          }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
          entries: [],
          count: 1,
          }),
      } as Response)

    const { getDiscographyEntries } = await import("@/lib/data/discography")
    const entries = await getDiscographyEntries()

    expect(fetchSpy).toHaveBeenCalled()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      id,
      productPath: `/products/${productHandle}`,
      formats: ["Vinyl", "CD"],
      releaseYear,
    })
  })

  it("returns empty entries when config is missing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/config/env", () => ({
      runtimeEnv: {
        medusaBackendUrl: "",
        medusaPublishableKey: "",
      },
    }))

    const { getDiscographyEntries } = await import("@/lib/data/discography")
    await expect(getDiscographyEntries()).resolves.toEqual([])
    expect(errorSpy).toHaveBeenCalled()
  })

  it("returns empty entries when the API returns a non-ok response", async () => {
    const medusaBackendUrl = faker.internet.url()
    const medusaPublishableKey = faker.string.alphanumeric(16)

    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/config/env", () => ({
      runtimeEnv: {
        medusaBackendUrl,
        medusaPublishableKey,
      },
    }))

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: faker.number.int({ min: 400, max: 599 }),
    } as Response)

    const { getDiscographyEntries } = await import("@/lib/data/discography")
    await expect(getDiscographyEntries()).resolves.toEqual([])
    expect(errorSpy).toHaveBeenCalled()
  })

  it("normalizes missing handles, invalid release year, and format detection", async () => {
    const medusaBackendUrl = faker.internet.url()
    const medusaPublishableKey = faker.string.alphanumeric(16)
    const id = faker.string.uuid()
    const fallbackAlbum = faker.music.songName()

    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/config/env", () => ({
      runtimeEnv: {
        medusaBackendUrl,
        medusaPublishableKey,
      },
    }))

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            entries: [
              {
                id,
                title: fallbackAlbum,
                artist: " ",
                album: fallbackAlbum,
                productHandle: " ",
                collectionTitle: null,
                catalogNumber: null,
                releaseDate: "not-a-date",
                releaseYear: null,
                formats: ["12-inch", "k7", "compact disc", faker.lorem.word()],
                genres: [faker.music.genre()],
                availability: "in_print",
                coverUrl: null,
              },
            ],
            count: 1,
          }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            entries: [],
            count: 1,
          }),
      } as Response)

    const { getDiscographyEntries } = await import("@/lib/data/discography")
    const entries = await getDiscographyEntries()
    expect(entries).toHaveLength(1)
    const entry = entries[0]
    expect(entry?.id).toBe(id)
    expect(entry?.productHandle).toBeNull()
    expect(entry?.productPath.startsWith("/products/")).toBe(true)
    expect(entry?.releaseYear).toBeNull()
    expect(entry?.formats).toEqual(["Vinyl", "CD", "Cassette"])
    expect(entry?.slug.artist).toBe(fallbackAlbum)
    expect(entry?.slug.album).toBe(fallbackAlbum)
  })
})
