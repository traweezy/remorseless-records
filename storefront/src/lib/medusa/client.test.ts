import { faker } from "@faker-js/faker"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("medusa client initialization", () => {
  beforeEach(() => {
    faker.seed(1301)
  })

  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it("creates medusa sdk and exposes store client", async () => {
    const sdkInstance = {
      store: { product: { list: vi.fn() } },
    }
    const ctorSpy = vi.fn()

    class MedusaMock {
      store = sdkInstance.store

      constructor(config: Record<string, unknown>) {
        ctorSpy(config)
      }
    }

    const backendUrl = faker.internet.url()
    const publishableKey = `pk_${faker.string.alphanumeric(12)}`

    vi.doMock("@medusajs/js-sdk", () => ({
      default: MedusaMock,
    }))
    vi.doMock("@/config/env", () => ({
      runtimeEnv: {
        medusaBackendUrl: backendUrl,
        medusaPublishableKey: publishableKey,
      },
    }))

    const { medusa, storeClient } = await import("@/lib/medusa/client")
    expect(medusa).toBeInstanceOf(MedusaMock)
    expect(storeClient).toBe(sdkInstance.store)
    expect(ctorSpy).toHaveBeenCalledWith({
      baseUrl: backendUrl,
      publishableKey,
      debug: false,
    })
  })

  it("throws when publishable key is missing", async () => {
    const backendUrl = faker.internet.url()

    vi.doMock("@medusajs/js-sdk", () => ({
      default: vi.fn(),
    }))
    vi.doMock("@/config/env", () => ({
      runtimeEnv: {
        medusaBackendUrl: backendUrl,
        medusaPublishableKey: "",
      },
    }))

    await expect(import("@/lib/medusa/client")).rejects.toThrow(
      "NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY is required"
    )
  })

  it("re-exports medusa client through lib/medusa", async () => {
    const fakeMedusa = { store: {} }
    vi.doMock("@/lib/medusa/client", () => ({
      medusa: fakeMedusa,
      storeClient: fakeMedusa.store,
    }))

    const mod = await import("@/lib/medusa")
    expect(mod.medusa).toBe(fakeMedusa)
    expect(mod.storeClient).toBe(fakeMedusa.store)
  })
})
