import { describe, expect, it, vi } from "vitest"

import {
  hasExplicitPublicPersistence,
  LEGACY_QUERY_CACHE_KEY,
  removeLegacyQueryCache,
} from "./query-provider"

describe("query persistence privacy boundary", () => {
  it("requires an explicit public-data persistence declaration", () => {
    expect(hasExplicitPublicPersistence(undefined)).toBe(false)
    expect(hasExplicitPublicPersistence({})).toBe(false)
    expect(hasExplicitPublicPersistence({ persist: false })).toBe(false)
    expect(hasExplicitPublicPersistence({ persist: "true" })).toBe(false)
    expect(hasExplicitPublicPersistence({ persist: true })).toBe(true)
  })

  it("removes the legacy default-on cache key", () => {
    const removeItem = vi.fn()

    removeLegacyQueryCache({ removeItem })

    expect(removeItem).toHaveBeenCalledWith(LEGACY_QUERY_CACHE_KEY)
  })
})
