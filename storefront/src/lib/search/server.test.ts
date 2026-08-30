import { faker } from "@faker-js/faker"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const makeSearchResponse = () => ({
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

const mockServerDependencies = ({
  enrichSearchResponse = vi.fn((response: unknown) => response),
  searchProductsWithClient,
}: {
  enrichSearchResponse?: ReturnType<typeof vi.fn>
  searchProductsWithClient: ReturnType<typeof vi.fn>
}) => {
  const ctorSpy = vi.fn()
  const meiliHost = faker.internet.url()
  const meiliKey = faker.string.alphanumeric(24)

  class MeilisearchMock {
    constructor(config: Record<string, unknown>) {
      ctorSpy(config)
    }
  }

  vi.doMock("meilisearch", () => ({ Meilisearch: MeilisearchMock }))
  vi.doMock("@/config/env.search.server", () => ({
    searchServerEnv: {
      meiliHost,
      meiliSearchKey: meiliKey,
    },
  }))
  vi.doMock("@/lib/search/search", () => ({ searchProductsWithClient }))
  vi.doMock("@/lib/search/enrich", () => ({ enrichSearchResponse }))

  return { ctorSpy, meiliHost, meiliKey, MeilisearchMock }
}

describe("searchProductsServer", () => {
  beforeEach(() => {
    faker.seed(1401)
    vi.spyOn(console, "info").mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it("creates a server client and enriches search response", async () => {
    const query = faker.word.noun()
    const hitId = faker.string.uuid()
    const searchProductsWithClient = vi
      .fn()
      .mockResolvedValue(makeSearchResponse())
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
    const { ctorSpy, meiliHost, meiliKey, MeilisearchMock } =
      mockServerDependencies({
        enrichSearchResponse,
        searchProductsWithClient,
      })

    const { searchProductsServer } = await import("@/lib/search/server")
    const result = await searchProductsServer({ query })

    expect(ctorSpy).toHaveBeenCalledTimes(1)
    expect(ctorSpy).toHaveBeenCalledWith({
      host: meiliHost,
      apiKey: meiliKey,
    })
    expect(searchProductsWithClient).toHaveBeenCalledTimes(1)
    const searchCall = searchProductsWithClient.mock.calls[0]
    expect(searchCall?.[0]).toBeInstanceOf(MeilisearchMock)
    expect(searchCall?.[1]).toEqual({ query })
    expect(searchCall?.[2]).toBeUndefined()
    expect(searchCall?.[3]).toBeInstanceOf(AbortSignal)
    expect(enrichSearchResponse).toHaveBeenCalledTimes(1)
    expect(result.hits).toEqual([{ id: hitId }])
  })

  it("retries transport failures under one shared deadline", async () => {
    vi.useFakeTimers()
    const transportError = Object.assign(
      new Error("https://search.test/private-key"),
      { name: "MeiliSearchRequestError" }
    )
    const searchProductsWithClient = vi
      .fn()
      .mockRejectedValueOnce(transportError)
      .mockResolvedValueOnce(makeSearchResponse())
    mockServerDependencies({ searchProductsWithClient })

    const { searchProductsServer } = await import("@/lib/search/server")
    const pending = searchProductsServer({ query: faker.word.noun() })
    await vi.advanceTimersByTimeAsync(100)

    await expect(pending).resolves.toEqual(makeSearchResponse())
    expect(searchProductsWithClient).toHaveBeenCalledTimes(2)
    expect(searchProductsWithClient.mock.calls[0]?.[3]).toBe(
      searchProductsWithClient.mock.calls[1]?.[3]
    )
    expect(console.info).toHaveBeenCalledWith(
      "[search] Retrying transient provider read",
      { attempt: 2, delay_ms: 100, max_attempts: 2 }
    )
  })

  it("retries transient API responses and honors bounded Retry-After", async () => {
    vi.useFakeTimers()
    const apiError = Object.assign(new Error("provider response body"), {
      name: "MeiliSearchApiError",
      response: new Response(null, {
        status: 503,
        headers: { "retry-after": "0" },
      }),
    })
    const searchProductsWithClient = vi
      .fn()
      .mockRejectedValueOnce(apiError)
      .mockResolvedValueOnce(makeSearchResponse())
    mockServerDependencies({ searchProductsWithClient })

    const { searchProductsServer } = await import("@/lib/search/server")
    const pending = searchProductsServer({ query: faker.word.noun() })
    await vi.advanceTimersByTimeAsync(100)

    await expect(pending).resolves.toEqual(makeSearchResponse())
    expect(searchProductsWithClient).toHaveBeenCalledTimes(2)
  })

  it("stops retry backoff when the caller cancels", async () => {
    vi.useFakeTimers()
    const caller = new AbortController()
    const transportError = Object.assign(new Error("provider unavailable"), {
      name: "MeiliSearchRequestError",
    })
    const searchProductsWithClient = vi.fn().mockRejectedValue(transportError)
    mockServerDependencies({ searchProductsWithClient })

    const { searchProductsServer } = await import("@/lib/search/server")
    const failure = searchProductsServer(
      { query: faker.word.noun() },
      caller.signal
    ).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(0)
    caller.abort()

    await expect(failure).resolves.toMatchObject({
      kind: "timeout",
      name: "ProviderRequestError",
    })
    expect(searchProductsWithClient).toHaveBeenCalledTimes(1)
  })

  it("does not retry non-transient API failures and redacts details", async () => {
    const apiError = Object.assign(
      new Error("provider body contained customer@example.test"),
      {
        name: "MeiliSearchApiError",
        response: new Response(null, { status: 400 }),
      }
    )
    const searchProductsWithClient = vi.fn().mockRejectedValue(apiError)
    mockServerDependencies({ searchProductsWithClient })

    const { searchProductsServer } = await import("@/lib/search/server")
    const result = await searchProductsServer({ query: faker.word.noun() }).catch(
      (error: unknown) => error
    )

    expect(result).toMatchObject({
      kind: "unavailable",
      message: "The upstream provider request failed",
      name: "ProviderRequestError",
    })
    expect(JSON.stringify(result)).not.toContain("customer")
    expect(searchProductsWithClient).toHaveBeenCalledTimes(1)
    expect(console.info).not.toHaveBeenCalled()
  })
})
