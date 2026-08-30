import { faker } from "@faker-js/faker"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const loadSearchServerEnv = async () => {
  vi.resetModules()
  return import("@/config/env.search.server")
}

describe("searchServerEnv", () => {
  beforeEach(() => {
    faker.seed(2151)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("prefers server-only host and search key variables", async () => {
    const meiliHost = faker.internet.url()
    const meiliSearchKey = faker.string.alphanumeric(32)
    vi.stubEnv("MEILISEARCH_HOST", meiliHost)
    vi.stubEnv("MEILISEARCH_SEARCH_KEY", meiliSearchKey)
    vi.stubEnv("NEXT_PUBLIC_MEILI_HOST", faker.internet.url())
    vi.stubEnv("NEXT_PUBLIC_MEILI_SEARCH_KEY", faker.string.alphanumeric(32))

    const { searchServerEnv } = await loadSearchServerEnv()

    expect(searchServerEnv).toEqual({
      meiliHost,
      meiliSearchKey,
    })
  })

  it("accepts the existing server-only API key during migration", async () => {
    const meiliHost = faker.internet.url()
    const meiliSearchKey = faker.string.alphanumeric(32)
    vi.stubEnv("MEILISEARCH_HOST", meiliHost)
    vi.stubEnv("MEILISEARCH_SEARCH_KEY", undefined)
    vi.stubEnv("MEILISEARCH_API_KEY", meiliSearchKey)

    const { searchServerEnv } = await loadSearchServerEnv()

    expect(searchServerEnv).toEqual({
      meiliHost,
      meiliSearchKey,
    })
  })

  it("rejects the retired public pair without server-only variables", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined)
    vi.stubEnv("MEILISEARCH_HOST", undefined)
    vi.stubEnv("MEILISEARCH_SEARCH_KEY", undefined)
    vi.stubEnv("MEILISEARCH_API_KEY", undefined)
    vi.stubEnv("NEXT_PUBLIC_MEILI_HOST", faker.internet.url())
    vi.stubEnv("NEXT_PUBLIC_MEILI_SEARCH_KEY", faker.string.alphanumeric(32))

    await expect(loadSearchServerEnv()).rejects.toThrow(
      "Search server environment validation failed"
    )
    expect(errorSpy).toHaveBeenCalled()
  })

  it("rejects a host-enabled preferred pair without a key", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined)
    vi.stubEnv("MEILISEARCH_HOST", faker.internet.url())
    vi.stubEnv("MEILISEARCH_SEARCH_KEY", undefined)
    vi.stubEnv("MEILISEARCH_API_KEY", undefined)
    vi.stubEnv("NEXT_PUBLIC_MEILI_HOST", faker.internet.url())
    vi.stubEnv("NEXT_PUBLIC_MEILI_SEARCH_KEY", faker.string.alphanumeric(32))

    await expect(loadSearchServerEnv()).rejects.toThrow(
      "Search server environment validation failed"
    )
    expect(errorSpy).toHaveBeenCalled()
  })

  it("rejects an incomplete or invalid search pair", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined)
    vi.stubEnv("MEILISEARCH_HOST", "not-a-url")
    vi.stubEnv("MEILISEARCH_SEARCH_KEY", "")
    vi.stubEnv("MEILISEARCH_API_KEY", undefined)
    vi.stubEnv("NEXT_PUBLIC_MEILI_HOST", faker.internet.url())
    vi.stubEnv("NEXT_PUBLIC_MEILI_SEARCH_KEY", faker.string.alphanumeric(32))

    await expect(loadSearchServerEnv()).rejects.toThrow(
      "Search server environment validation failed"
    )
    expect(errorSpy).toHaveBeenCalled()
  })
})
