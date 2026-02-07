import { faker } from "@faker-js/faker"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { shouldBlockPrefetch } from "@/lib/prefetch"

describe("shouldBlockPrefetch", () => {
  beforeEach(() => {
    faker.seed(2701)
  })

  it("returns false when connection data is unavailable", () => {
    vi.stubGlobal("navigator", {})
    expect(shouldBlockPrefetch()).toBe(false)
  })

  it("returns false when navigator is undefined", () => {
    vi.stubGlobal("navigator", undefined)
    expect(shouldBlockPrefetch()).toBe(false)
  })

  it("blocks prefetch when save-data is enabled", () => {
    vi.stubGlobal("navigator", { connection: { saveData: true } })
    expect(shouldBlockPrefetch()).toBe(true)
  })

  it("blocks prefetch on very slow effective connections", () => {
    vi.stubGlobal("navigator", { connection: { effectiveType: "2g" } })
    expect(shouldBlockPrefetch()).toBe(true)

    vi.stubGlobal("navigator", { connection: { effectiveType: "slow-2g" } })
    expect(shouldBlockPrefetch()).toBe(true)
  })

  it("allows prefetch for faster connections", () => {
    vi.stubGlobal("navigator", { connection: { effectiveType: faker.helpers.arrayElement(["3g", "4g"]) } })
    expect(shouldBlockPrefetch()).toBe(false)
  })

  it("returns false when connection has no effective type", () => {
    vi.stubGlobal("navigator", { connection: {} })
    expect(shouldBlockPrefetch()).toBe(false)
  })
})
