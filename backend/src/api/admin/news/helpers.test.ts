import { randomUUID } from "node:crypto"

import type { MedusaRequest } from "@medusajs/framework"

import type { NewsEntryRecord } from "@/modules/news/serializers"
import type { NewsService } from "./helpers"
import {
  createNewsEntry,
  setNewsEntryArchived,
  updateNewsEntry,
} from "./helpers"

type OperationRecord = {
  actor_id: string | null
  aggregate_id: string
  command: string
  completed_at: Date | null
  expected_version: number
  id: string
  idempotency_key: string
  metadata: Record<string, unknown>
  request_sha256: string
  result: Record<string, unknown>
  status: "pending" | "succeeded"
}

const newsRecord = (
  overrides: Partial<NewsEntryRecord> = {}
): NewsEntryRecord => ({
  archived_at: null,
  author: "Original Author",
  content: "<p>Original body</p>",
  cover_alt_text: null,
  cover_url: null,
  created_at: new Date("2026-08-01T00:00:00.000Z"),
  excerpt: null,
  id: "news_existing",
  published_at: null,
  seo_description: "Original body",
  seo_title: "Original · Remorseless Records",
  slug: "original",
  status: "draft",
  tags: [],
  title: "Original",
  updated_at: new Date("2026-08-01T00:00:00.000Z"),
  version: 1,
  ...overrides,
})

const requestFixture = (): MedusaRequest =>
  ({
    auth_context: { actor_id: "user_admin" },
    scope: {
      resolve: jest.fn(() => async () => [
        {
          email: "admin@example.com",
          first_name: "Ada",
          last_name: "Admin",
        },
      ]),
    },
  }) as unknown as MedusaRequest

const serviceFixture = (initialEntries: NewsEntryRecord[] = []) => {
  const entries = new Map(initialEntries.map((entry) => [entry.id, entry]))
  const operations = new Map<string, OperationRecord>()
  let entrySequence = initialEntries.length
  let operationSequence = 0

  const service = {
    createNewsEntries: jest.fn(
      async (payloads: Array<Record<string, unknown>>) =>
        payloads.map((payload) => {
          entrySequence += 1
          const entry = newsRecord({
            ...payload,
            created_at: new Date("2026-08-02T00:00:00.000Z"),
            id: `news_${entrySequence}`,
            updated_at: new Date("2026-08-02T00:00:00.000Z"),
          } as Partial<NewsEntryRecord>)
          entries.set(entry.id, entry)
          return entry
        })
    ),
    createNewsOperations: jest.fn(
      async (payloads: Array<Omit<OperationRecord, "id" | "completed_at">>) =>
        payloads.map((payload) => {
          operationSequence += 1
          const operation: OperationRecord = {
            ...payload,
            completed_at: null,
            id: `newsop_${operationSequence}`,
          }
          operations.set(operation.idempotency_key, operation)
          return operation
        })
    ),
    listNewsEntries: jest.fn(async (filters: Record<string, unknown>) =>
      [...entries.values()].filter((entry) =>
        typeof filters.slug === "string" ? entry.slug === filters.slug : true
      )
    ),
    listNewsOperations: jest.fn(
      async ({ idempotency_key }: { idempotency_key: string }) => {
        const operation = operations.get(idempotency_key)
        return operation ? [operation] : []
      }
    ),
    retrieveNewsEntry: jest.fn(async (id: string) => entries.get(id) ?? null),
    runNewsTransaction: jest.fn(
      async <T>(task: (context: Record<string, never>) => Promise<T>) => task({})
    ),
    updateNewsEntries: jest.fn(
      async (payloads: Array<Record<string, unknown>>) =>
        payloads.map((payload) => {
          const id = String(payload.id)
          const existing = entries.get(id)
          if (!existing) {
            return undefined
          }
          const updated = newsRecord({
            ...existing,
            ...payload,
            updated_at: new Date("2026-08-02T01:00:00.000Z"),
          } as Partial<NewsEntryRecord>)
          entries.set(id, updated)
          return updated
        })
    ),
    updateNewsOperations: jest.fn(
      async (payloads: Array<Partial<OperationRecord> & { id: string }>) =>
        payloads.map((payload) => {
          const existing = [...operations.values()].find(
            (operation) => operation.id === payload.id
          )
          if (!existing) {
            return undefined
          }
          const updated = { ...existing, ...payload } as OperationRecord
          operations.set(updated.idempotency_key, updated)
          return updated
        })
    ),
  } as unknown as NewsService

  return { entries, operations, service }
}

describe("news lifecycle commands", () => {
  it("creates a sanitized post and replays the exact stored response", async () => {
    const { entries, operations, service } = serviceFixture()
    const idempotencyKey = randomUUID()
    const input = {
      content: '<p>Hello</p><script>alert("x")</script>',
      coverAltText: "Red and black release artwork",
      coverUrl: "https://cdn.example.com/news.jpg",
      expectedVersion: 0 as const,
      idempotencyKey,
      status: "draft" as const,
      tags: ["Updates", "updates", " Studio "],
      title: "Studio Update",
    }

    const created = await createNewsEntry(requestFixture(), service, input)
    expect(created.replayed).toBe(false)
    expect(created.entry).toMatchObject({
      author: "Ada Admin",
      content: "<p>Hello</p>",
      coverAltText: "Red and black release artwork",
      slug: "studio-update",
      status: "draft",
      tags: ["Updates", "Studio"],
      version: 1,
    })
    expect(entries.size).toBe(1)
    expect(operations.get(idempotencyKey)).toMatchObject({
      actor_id: "user_admin",
      status: "succeeded",
    })

    const createdRecord = [...entries.values()][0]
    if (!createdRecord) {
      throw new Error("Expected the created news record")
    }
    entries.set(createdRecord.id, newsRecord({
      ...createdRecord,
      title: "Changed later",
      version: 2,
    }))
    const replayRequest = requestFixture()
    ;(replayRequest.scope.resolve as jest.Mock).mockImplementation(() => {
      throw new Error("Author lookup must not run during an exact replay")
    })
    const replayed = await createNewsEntry(replayRequest, service, input)
    expect(replayed).toEqual({ ...created, replayed: true })
    expect(entries.size).toBe(1)
  })

  it("uses a deterministic numeric slug after a title collision", async () => {
    const { service } = serviceFixture([
      newsRecord({ id: "news_1", slug: "studio-update" }),
    ])
    const created = await createNewsEntry(requestFixture(), service, {
      content: "<p>Body</p>",
      expectedVersion: 0,
      idempotencyKey: randomUUID(),
      title: "Studio Update",
    })
    expect(created.entry.slug).toBe("studio-update-2")
  })

  it("preserves author and slug while enforcing expected version", async () => {
    const { service } = serviceFixture([newsRecord()])
    const updated = await updateNewsEntry(
      requestFixture(),
      service,
      "news_existing",
      {
        content: "<p>Revised body</p>",
        expectedVersion: 1,
        idempotencyKey: randomUUID(),
        title: "Revised title",
      }
    )
    expect(updated.entry).toMatchObject({
      author: "Original Author",
      slug: "original",
      title: "Revised title",
      version: 2,
    })

    await expect(
      updateNewsEntry(requestFixture(), service, "news_existing", {
        excerpt: "Stale update",
        expectedVersion: 1,
        idempotencyKey: randomUUID(),
      })
    ).rejects.toThrow("changed after it was loaded")
  })

  it("supports future scheduling and rejects invalid publication states", async () => {
    const { service } = serviceFixture()
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const scheduled = await createNewsEntry(requestFixture(), service, {
      content: "<p>Scheduled body</p>",
      expectedVersion: 0,
      idempotencyKey: randomUUID(),
      publishedAt: future,
      status: "scheduled",
      title: "Scheduled post",
    })
    expect(scheduled.entry).toMatchObject({
      publishedAt: future,
      status: "scheduled",
    })

    await expect(
      createNewsEntry(requestFixture(), service, {
        content: "<p>Draft body</p>",
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
        publishedAt: future,
        status: "draft",
        title: "Invalid draft",
      })
    ).rejects.toThrow("Draft posts cannot have a publication date")

    await expect(
      createNewsEntry(requestFixture(), service, {
        content: "<p>Published body</p>",
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
        publishedAt: future,
        status: "published",
        title: "Invalid publication",
      })
    ).rejects.toThrow("Future publication dates must use Scheduled")
  })

  it("requires useful cover semantics and visible sanitized content", async () => {
    const { service } = serviceFixture()
    await expect(
      createNewsEntry(requestFixture(), service, {
        content: "<p>Body</p>",
        coverUrl: "https://cdn.example.com/news.jpg",
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
        title: "Missing alt",
      })
    ).rejects.toThrow("Cover alt text is required")

    await expect(
      createNewsEntry(requestFixture(), service, {
        content: "<script>alert(1)</script>",
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
        title: "Invisible body",
      })
    ).rejects.toThrow("must include visible text")
  })

  it("archives and restores without losing the publication state", async () => {
    const publishedAt = new Date("2026-08-01T00:00:00.000Z")
    const { service } = serviceFixture([
      newsRecord({ published_at: publishedAt, status: "published" }),
    ])
    const archiveKey = randomUUID()
    const archived = await setNewsEntryArchived(
      requestFixture(),
      service,
      "news_existing",
      { expectedVersion: 1, idempotencyKey: archiveKey },
      true
    )
    expect(archived.entry).toMatchObject({
      status: "archived",
      version: 2,
    })
    expect(archived.entry.archivedAt).not.toBeNull()

    await expect(
      updateNewsEntry(requestFixture(), service, "news_existing", {
        excerpt: "Blocked",
        expectedVersion: 2,
        idempotencyKey: randomUUID(),
      })
    ).rejects.toThrow("Restore the news post")

    const restored = await setNewsEntryArchived(
      requestFixture(),
      service,
      "news_existing",
      { expectedVersion: 2, idempotencyKey: randomUUID() },
      false
    )
    expect(restored.entry).toMatchObject({
      archivedAt: null,
      publishedAt: publishedAt.toISOString(),
      status: "published",
      version: 3,
    })

    const replayedArchive = await setNewsEntryArchived(
      requestFixture(),
      service,
      "news_existing",
      { expectedVersion: 1, idempotencyKey: archiveKey },
      true
    )
    expect(replayedArchive.entry).toEqual(archived.entry)
  })

  it("rejects reuse of an idempotency key for a different payload", async () => {
    const { service } = serviceFixture()
    const idempotencyKey = randomUUID()
    await createNewsEntry(requestFixture(), service, {
      content: "<p>Body</p>",
      expectedVersion: 0,
      idempotencyKey,
      title: "Original request",
    })
    await expect(
      createNewsEntry(requestFixture(), service, {
        content: "<p>Different body</p>",
        expectedVersion: 0,
        idempotencyKey,
        title: "Different request",
      })
    ).rejects.toThrow("cannot be replayed")
  })
})
