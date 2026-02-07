import { faker } from "@faker-js/faker"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("resolveRegionId", () => {
  beforeEach(() => {
    faker.seed(1601)
  })

  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it("prefers region that contains configured country and caches result", async () => {
    const preferredCountry = faker.location.countryCode("alpha-2")
    const otherCountry = faker.helpers.arrayElement(["de", "fr", "ca", "br"])

    const list = vi.fn().mockResolvedValue({
      regions: [
        { id: faker.string.uuid(), countries: [{ iso_2: otherCountry }] },
        { id: "region_match", countries: [{ iso_2: preferredCountry.toLowerCase() }] },
      ],
    })

    vi.doMock("@/config/site", () => ({
      siteMetadata: {
        contact: { address: { country: preferredCountry } },
      },
    }))
    vi.doMock("@/lib/medusa/client", () => ({
      storeClient: { region: { list } },
    }))

    const { resolveRegionId } = await import("@/lib/regions")
    await expect(resolveRegionId()).resolves.toBe("region_match")
    await expect(resolveRegionId()).resolves.toBe("region_match")
    expect(list).toHaveBeenCalledTimes(1)
  })

  it("falls back to first region when preferred country does not match", async () => {
    const firstRegionId = faker.string.uuid()

    vi.doMock("@/config/site", () => ({
      siteMetadata: {
        contact: { address: { country: faker.location.countryCode("alpha-2") } },
      },
    }))
    vi.doMock("@/lib/medusa/client", () => ({
      storeClient: {
        region: {
          list: vi.fn().mockResolvedValue({
            regions: [{ id: firstRegionId, countries: [{ iso_2: "us" }] }],
          }),
        },
      },
    }))

    const { resolveRegionId } = await import("@/lib/regions")
    await expect(resolveRegionId()).resolves.toBe(firstRegionId)
  })

  it("throws when no region ids are available", async () => {
    vi.doMock("@/config/site", () => ({
      siteMetadata: {
        contact: { address: { country: "US" } },
      },
    }))
    vi.doMock("@/lib/medusa/client", () => ({
      storeClient: {
        region: {
          list: vi.fn().mockResolvedValue({
            regions: [],
          }),
        },
      },
    }))

    const { resolveRegionId } = await import("@/lib/regions")
    await expect(resolveRegionId()).rejects.toThrow("No regions configured in Medusa")
  })
})
