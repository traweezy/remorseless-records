import { faker } from "@faker-js/faker"
import { beforeEach, describe, expect, it, vi } from "vitest"

describe("siteMetadata", () => {
  beforeEach(() => {
    faker.seed(2301)
  })

  it("builds absolute asset urls using runtime site url", async () => {
    const siteUrl = faker.internet.url()

    vi.resetModules()
    vi.doMock("@/config/env", () => ({
      runtimeEnv: {
        siteUrl,
      },
    }))

    const { siteMetadata, seoHelpers } = await import("@/config/site")
    const heroLogoUrl = new URL("/remorseless-hero-logo.png", siteUrl).toString()
    const catalogUrl = new URL("/catalog", siteUrl).toString()

    expect(siteMetadata.siteUrl).toBe(siteUrl)
    expect(siteMetadata.assets.heroLogo).toBe(heroLogoUrl)
    expect(seoHelpers.absolute("/catalog")).toBe(catalogUrl)
  })

  it("falls back to default site url when runtime value is missing", async () => {
    vi.resetModules()
    vi.doMock("@/config/env", () => ({
      runtimeEnv: {
        siteUrl: null,
      },
    }))

    const { siteMetadata, seoHelpers } = await import("@/config/site")
    expect(siteMetadata.siteUrl).toBe("https://www.remorselessrecords.com")
    expect(seoHelpers.absolute("/products")).toBe(
      "https://www.remorselessrecords.com/products"
    )
  })
})
