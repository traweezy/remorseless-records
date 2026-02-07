import { faker } from "@faker-js/faker"
import { beforeEach, describe, expect, it, vi } from "vitest"

describe("runtimeEnv", () => {
  beforeEach(() => {
    faker.seed(2201)
  })

  it("merges client and server env and derives medusa backend url", async () => {
    const siteUrl = faker.internet.url()
    const medusaUrl = faker.internet.url()
    const medusaPublishableKey = faker.string.alphanumeric(12)
    const stripePublishableKey = faker.string.alphanumeric(12)
    const meiliHost = faker.internet.url()
    const meiliSearchKey = faker.string.alphanumeric(12)

    vi.resetModules()
    vi.doMock("@/config/env.client", () => ({
      clientEnv: {
        siteUrl,
        medusaUrl,
        medusaPublishableKey,
        stripePublishableKey,
        meiliHost,
        meiliSearchKey,
        mediaUrl: null,
        assetHost: null,
      },
    }))
    vi.doMock("@/config/env.server", () => ({
      serverEnv: {
        medusaBackendUrl: null,
      },
    }))

    const { runtimeEnv } = await import("@/config/env")
    expect(runtimeEnv.medusaBackendUrl).toBe(medusaUrl)
    expect(runtimeEnv.siteUrl).toBe(siteUrl)
  })
})
