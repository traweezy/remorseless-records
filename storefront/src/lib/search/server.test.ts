import { faker } from "@faker-js/faker"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("searchProductsServer", () => {
  beforeEach(() => {
    faker.seed(1401)
  })

  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it("creates a server client and enriches search response", async () => {
    const ctorSpy = vi.fn()
    const meiliHost = faker.internet.url()
    const meiliKey = faker.string.alphanumeric(24)
    const query = faker.word.noun()
    const hitId = faker.string.uuid()

    class MeiliSearchMock {
      constructor(config: Record<string, unknown>) {
        ctorSpy(config)
      }
    }

    const searchProductsWithClient = vi.fn().mockResolvedValue({
      hits: [],
      total: 0,
      offset: 0,
      facets: {
        genres: {},
        metalGenres: {},
        format: {},
        categories: {},
        variants: {},
        productTypes: {},
      },
    })
    const enrichSearchResponse = vi.fn().mockResolvedValue({
      hits: [{ id: hitId }],
      total: 1,
      offset: 0,
      facets: {
        genres: {},
        metalGenres: {},
        format: {},
        categories: {},
        variants: {},
        productTypes: {},
      },
    })

    vi.doMock("meilisearch", () => ({ MeiliSearch: MeiliSearchMock }))
    vi.doMock("@/config/env", () => ({
      runtimeEnv: {
        meiliHost,
        meiliSearchKey: meiliKey,
      },
    }))
    vi.doMock("@/lib/search/search", () => ({
      searchProductsWithClient,
    }))
    vi.doMock("@/lib/search/enrich", () => ({
      enrichSearchResponse,
    }))

    const { searchProductsServer } = await import("@/lib/search/server")
    const result = await searchProductsServer({ query })

    expect(ctorSpy).toHaveBeenCalledTimes(1)
    expect(ctorSpy).toHaveBeenCalledWith({
      host: meiliHost,
      apiKey: meiliKey,
    })
    expect(searchProductsWithClient).toHaveBeenCalledTimes(1)
    expect(enrichSearchResponse).toHaveBeenCalledTimes(1)
    expect(result.hits).toEqual([{ id: hitId }])
  })

  it("throws when server meilisearch config is missing", async () => {
    vi.doMock("meilisearch", () => ({ MeiliSearch: vi.fn() }))
    vi.doMock("@/config/env", () => ({
      runtimeEnv: {
        meiliHost: "",
        meiliSearchKey: "",
      },
    }))
    vi.doMock("@/lib/search/search", () => ({
      searchProductsWithClient: vi.fn(),
    }))
    vi.doMock("@/lib/search/enrich", () => ({
      enrichSearchResponse: vi.fn(),
    }))

    const { searchProductsServer } = await import("@/lib/search/server")
    await expect(searchProductsServer({ query: "doom" })).rejects.toThrow(
      "Meilisearch configuration missing"
    )
  })
})
