import { faker } from "@faker-js/faker"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const loadServerEnv = async () => {
  vi.resetModules()
  return import("@/config/env.server")
}

describe("serverEnv", () => {
  beforeEach(() => {
    faker.seed(2101)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("maps backend url when present", async () => {
    const backendUrl = faker.internet.url()
    vi.stubEnv("MEDUSA_BACKEND_URL", backendUrl)

    const { serverEnv } = await loadServerEnv()
    expect(serverEnv.medusaBackendUrl).toBe(backendUrl)
  })

  it("falls back to null when backend url is not set", async () => {
    vi.stubEnv("MEDUSA_BACKEND_URL", undefined)

    const { serverEnv } = await loadServerEnv()
    expect(serverEnv.medusaBackendUrl).toBeNull()
  })

  it("throws on invalid backend url", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.stubEnv("MEDUSA_BACKEND_URL", "invalid-url")

    await expect(loadServerEnv()).rejects.toThrow(
      "Server environment variables validation failed"
    )
    expect(errorSpy).toHaveBeenCalled()
  })
})
