import type { CacheEvictionEvent } from "./bounded-expiring-cache"
import { BoundedExpiringCache } from "./bounded-expiring-cache"

describe("BoundedExpiringCache", () => {
  it("expires entries and reports only aggregate eviction metadata", () => {
    let now = 1_000
    const events: CacheEvictionEvent[] = []
    const cache = new BoundedExpiringCache<string, string>({
      maxEntries: 2,
      now: () => now,
      onEviction: (event) => events.push(event),
    })

    cache.set("sensitive-key", "value", 1_100)
    expect(cache.get("sensitive-key")).toBe("value")
    now = 1_100
    expect(cache.get("sensitive-key")).toBeUndefined()
    expect(events).toEqual([{ count: 1, reason: "expired", size: 0 }])
    expect(JSON.stringify(events)).not.toContain("sensitive-key")
  })

  it("purges expired entries before applying its capacity limit", () => {
    let now = 1_000
    const cache = new BoundedExpiringCache<string, number>({
      maxEntries: 2,
      now: () => now,
    })
    cache.set("expired", 1, 1_010)
    cache.set("current", 2, 2_000)

    now = 1_010
    cache.set("new", 3, 2_000)

    expect(cache.size).toBe(2)
    expect(cache.get("expired")).toBeUndefined()
    expect(cache.get("current")).toBe(2)
    expect(cache.get("new")).toBe(3)
  })

  it("evicts the least-recently-used entry at capacity", () => {
    const events: CacheEvictionEvent[] = []
    const cache = new BoundedExpiringCache<string, number>({
      maxEntries: 2,
      now: () => 1_000,
      onEviction: (event) => events.push(event),
    })
    cache.set("old", 1, 2_000)
    cache.set("recent", 2, 2_000)
    expect(cache.get("old")).toBe(1)

    cache.set("new", 3, 2_000)

    expect(cache.get("recent")).toBeUndefined()
    expect(cache.get("old")).toBe(1)
    expect(cache.get("new")).toBe(3)
    expect(events).toContainEqual({ count: 1, reason: "capacity", size: 2 })
  })

  it("does not retain already expired values", () => {
    const cache = new BoundedExpiringCache<string, number>({
      maxEntries: 1,
      now: () => 1_000,
    })
    cache.set("expired", 1, 1_000)
    expect(cache.size).toBe(0)
  })

  it("rejects invalid bounds and expiry timestamps", () => {
    expect(() => new BoundedExpiringCache({ maxEntries: 0 })).toThrow(
      "positive integer"
    )
    const cache = new BoundedExpiringCache<string, number>({ maxEntries: 1 })
    expect(() => cache.set("key", 1, Number.NaN)).toThrow("safe integer")
  })
})
