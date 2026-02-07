import { faker } from "@faker-js/faker"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const loadClientEnv = async () => {
  vi.resetModules()
  return import("@/config/env.client")
}

describe("clientEnv", () => {
  beforeEach(() => {
    faker.seed(2001)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("loads environment variables from public and fallback keys", async () => {
    const siteUrl = faker.internet.url()
    const medusaUrl = faker.internet.url()
    const medusaPublishableKey = `pk_${faker.string.alphanumeric(12)}`
    const stripePublishableKey = `pk_${faker.string.alphanumeric(12)}`
    const meiliHost = faker.internet.url()
    const meiliSearchKey = faker.string.alphanumeric(18)

    vi.stubEnv("NEXT_PUBLIC_SITE_URL", siteUrl)
    vi.stubEnv("NEXT_PUBLIC_MEDUSA_URL", medusaUrl)
    vi.stubEnv("NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY", medusaPublishableKey)
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PK", stripePublishableKey)
    vi.stubEnv("NEXT_PUBLIC_MEILI_HOST", meiliHost)
    vi.stubEnv("NEXT_PUBLIC_MEILI_SEARCH_KEY", meiliSearchKey)

    const { clientEnv } = await loadClientEnv()

    expect(clientEnv).toMatchObject({
      siteUrl,
      medusaUrl,
      medusaPublishableKey,
      stripePublishableKey,
      meiliHost,
      meiliSearchKey,
      mediaUrl: null,
      assetHost: null,
    })
  })

  it("uses legacy fallback keys and optional media hosts", async () => {
    const siteUrl = faker.internet.url()
    const medusaUrl = faker.internet.url()
    const medusaPublishableKey = `pk_${faker.string.alphanumeric(10)}`
    const stripePublishableKey = `pk_${faker.string.alphanumeric(11)}`
    const meiliHost = faker.internet.url()
    const meiliSearchKey = faker.string.alphanumeric(14)
    const mediaUrl = faker.internet.url()
    const assetHost = faker.internet.url()

    delete process.env.NEXT_PUBLIC_SITE_URL
    delete process.env.NEXT_PUBLIC_MEDUSA_URL
    delete process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
    delete process.env.NEXT_PUBLIC_STRIPE_PK
    delete process.env.NEXT_PUBLIC_MEILI_SEARCH_KEY

    vi.stubEnv("NEXT_PUBLIC_BASE_URL", siteUrl)
    vi.stubEnv("NEXT_PUBLIC_MEDUSA_BACKEND_URL", medusaUrl)
    vi.stubEnv("MEDUSA_PUBLISHABLE_KEY", medusaPublishableKey)
    vi.stubEnv("NEXT_PUBLIC_STRIPE_KEY", stripePublishableKey)
    vi.stubEnv("NEXT_PUBLIC_MEILI_HOST", meiliHost)
    vi.stubEnv("MEILI_SEARCH_KEY", meiliSearchKey)
    vi.stubEnv("NEXT_PUBLIC_MEDIA_URL", mediaUrl)
    vi.stubEnv("NEXT_PUBLIC_ASSET_HOST", assetHost)

    const { clientEnv } = await loadClientEnv()

    expect(clientEnv).toMatchObject({
      siteUrl,
      medusaUrl,
      medusaPublishableKey,
      stripePublishableKey,
      meiliHost,
      meiliSearchKey,
      mediaUrl,
      assetHost,
    })
  })

  it("throws when required variables are invalid", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "not-a-url")
    vi.stubEnv("NEXT_PUBLIC_MEDUSA_URL", "")
    vi.stubEnv("NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY", "")
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PK", "")
    vi.stubEnv("NEXT_PUBLIC_MEILI_HOST", "")
    vi.stubEnv("NEXT_PUBLIC_MEILI_SEARCH_KEY", "")

    await expect(loadClientEnv()).rejects.toThrow(
      "Client environment variables validation failed"
    )
    expect(errorSpy).toHaveBeenCalled()
  })

  it("uses tertiary fallback keys and default site url", async () => {
    const medusaBackendUrl = faker.internet.url()
    const medusaPublishableApiKey = `pk_${faker.string.alphanumeric(9)}`
    const stripePublishableKey = `pk_${faker.string.alphanumeric(9)}`
    const meiliHost = faker.internet.url()
    const meiliSearchKey = faker.string.alphanumeric(13)

    delete process.env.NEXT_PUBLIC_SITE_URL
    delete process.env.NEXT_PUBLIC_BASE_URL
    delete process.env.NEXT_PUBLIC_MEDUSA_URL
    delete process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL
    delete process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
    delete process.env.MEDUSA_PUBLISHABLE_KEY
    delete process.env.NEXT_PUBLIC_STRIPE_PK
    delete process.env.NEXT_PUBLIC_STRIPE_KEY
    delete process.env.NEXT_PUBLIC_MEDIA_URL
    delete process.env.NEXT_PUBLIC_ASSET_HOST

    vi.stubEnv("MEDUSA_BACKEND_URL", medusaBackendUrl)
    vi.stubEnv("MEDUSA_PUBLISHABLE_API_KEY", medusaPublishableApiKey)
    vi.stubEnv("STRIPE_PUBLISHABLE_KEY", stripePublishableKey)
    vi.stubEnv("NEXT_PUBLIC_MEILI_HOST", meiliHost)
    vi.stubEnv("NEXT_PUBLIC_MEILI_SEARCH_KEY", meiliSearchKey)

    const { clientEnv } = await loadClientEnv()
    expect(clientEnv).toMatchObject({
      siteUrl: "https://www.remorselessrecords.com",
      medusaUrl: medusaBackendUrl,
      medusaPublishableKey: medusaPublishableApiKey,
      stripePublishableKey,
      meiliHost,
      meiliSearchKey,
      mediaUrl: null,
      assetHost: null,
    })
  })
})
