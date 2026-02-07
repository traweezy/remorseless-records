import { faker } from "@faker-js/faker"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("getBrowserSearchClient", () => {
  beforeEach(() => {
    faker.seed(1201)
  })

  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it("builds and caches the Meilisearch client", async () => {
    const host = faker.internet.url()
    const apiKey = faker.string.alphanumeric(20)
    const ctorSpy = vi.fn()

    class MeiliSearchMock {
      config: { host: string; apiKey: string }

      constructor(config: { host: string; apiKey: string }) {
        this.config = config
        ctorSpy(config)
      }
    }

    vi.doMock("meilisearch", () => ({ MeiliSearch: MeiliSearchMock }))
    vi.doMock("@/config/env", () => ({
      runtimeEnv: {
        meiliHost: host,
        meiliSearchKey: apiKey,
      },
    }))

    const { getBrowserSearchClient } = await import("@/lib/search/client")
    const first = getBrowserSearchClient()
    const second = getBrowserSearchClient()

    expect(first).toBe(second)
    expect(ctorSpy).toHaveBeenCalledTimes(1)
    expect(ctorSpy).toHaveBeenCalledWith({
      host,
      apiKey,
    })
  })

  it("throws when required meilisearch config is missing", async () => {
    vi.doMock("meilisearch", () => ({ MeiliSearch: vi.fn() }))
    vi.doMock("@/config/env", () => ({
      runtimeEnv: {
        meiliHost: "",
        meiliSearchKey: "",
      },
    }))

    const { getBrowserSearchClient } = await import("@/lib/search/client")
    expect(() => getBrowserSearchClient()).toThrow("Meilisearch host or API key missing")
  })
})
