import { z } from "zod"

import {
  clearAdminFormDraft,
  readAdminFormDraft,
  writeAdminFormDraft,
  type AdminFormDraftStorage,
} from "./admin-form-draft"

const createStorage = (): AdminFormDraftStorage & {
  entries: Map<string, string>
} => {
  const entries = new Map<string, string>()
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    removeItem: (key) => {
      entries.delete(key)
    },
    setItem: (key, value) => {
      entries.set(key, value)
    },
  }
}

const schema = z.object({ title: z.string().trim().min(1).max(100) })

describe("Admin form draft storage", () => {
  it("round-trips validated, expiring values", () => {
    const storage = createStorage()
    const now = new Date("2030-01-01T00:00:00.000Z")
    writeAdminFormDraft({
      key: "admin:test",
      now,
      schema,
      storage,
      ttlMs: 60_000,
      values: { title: " Release notes " },
    })

    expect(
      readAdminFormDraft({
        key: "admin:test",
        now: new Date("2030-01-01T00:00:30.000Z"),
        schema,
        storage,
      })
    ).toEqual({
      savedAt: now.toISOString(),
      values: { title: "Release notes" },
    })
  })

  it("removes expired, invalid, and oversized drafts", () => {
    const storage = createStorage()
    const key = "admin:test"
    writeAdminFormDraft({
      key,
      now: new Date("2030-01-01T00:00:00.000Z"),
      schema,
      storage,
      ttlMs: 1_000,
      values: { title: "Saved" },
    })
    expect(
      readAdminFormDraft({
        key,
        now: new Date("2030-01-01T00:00:02.000Z"),
        schema,
        storage,
      })
    ).toBeNull()
    expect(storage.entries.has(key)).toBe(false)

    storage.setItem(key, "not-json")
    expect(readAdminFormDraft({ key, schema, storage })).toBeNull()

    storage.setItem(key, "x".repeat(50))
    expect(
      readAdminFormDraft({ key, maxBytes: 10, schema, storage })
    ).toBeNull()
  })

  it("rejects unsafe values and bounded-storage overflow", () => {
    const storage = createStorage()
    expect(() =>
      writeAdminFormDraft({
        key: "admin:test",
        schema,
        storage,
        values: { title: "" },
      })
    ).toThrow()
    expect(() =>
      writeAdminFormDraft({
        key: "admin:test",
        maxBytes: 20,
        schema,
        storage,
        values: { title: "A valid title" },
      })
    ).toThrow(RangeError)
  })

  it("clears the selected namespaced draft only", () => {
    const storage = createStorage()
    storage.setItem("admin:one", "one")
    storage.setItem("admin:two", "two")
    clearAdminFormDraft({ key: "admin:one", storage })
    expect(storage.entries.has("admin:one")).toBe(false)
    expect(storage.entries.get("admin:two")).toBe("two")
  })
})
