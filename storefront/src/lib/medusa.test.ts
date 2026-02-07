import { faker } from "@faker-js/faker"
import { beforeEach, describe, expect, it, vi } from "vitest"

describe("lib/medusa re-export", () => {
  beforeEach(() => {
    faker.seed(3201)
    vi.resetModules()
  })

  it("re-exports medusa and storeClient from medusa/client", async () => {
    const medusa = { id: faker.string.uuid() }
    const storeClient = { product: { list: vi.fn() } }

    vi.doMock("@/lib/medusa/client", () => ({
      medusa,
      storeClient,
    }))

    const mod = await import("@/lib/medusa")
    expect(mod.medusa).toBe(medusa)
    expect(mod.storeClient).toBe(storeClient)
  })

  it("loads real medusa re-export module", async () => {
    vi.resetModules()
    const mod = await import("@/lib/medusa")
    expect(mod.medusa).toBeDefined()
    expect(mod.storeClient).toBeDefined()
  })
})
