import { randomUUID } from "node:crypto"

import type { MedusaRequest } from "@medusajs/framework"

import { hashCatalogCommand } from "@/modules/catalog/catalog-command"
import type { NewsEntryRecord } from "@/modules/news/serializers"
import type { NewsUpdateInput } from "./contracts"
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

const requestFixture = (actorId = "user_admin"): MedusaRequest =>
  ({
    auth_context: { actor_id: actorId, actor_type: "user" },
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
  const flush = jest.fn(async () => {})
  const context = { transactionManager: { flush } }

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
      async <T>(task: (sharedContext: typeof context) => Promise<T>) =>
        task(context)
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

  return { entries, operations, service, flush, context }
}

describe("news lifecycle commands", () => {
  it("flushes native timestamp defaults before recording the create receipt", async () => {
    const { entries, operations, service, flush, context } = serviceFixture()
    const nativeCreate = jest
      .mocked(service.createNewsEntries)
      .getMockImplementation()!
    let rawAcknowledgement: NewsEntryRecord[] = []
    jest
      .mocked(service.createNewsEntries)
      .mockImplementation(async (...args) => {
        const created = await nativeCreate(...args)
        rawAcknowledgement = (Array.isArray(created) ? created : [created]).map(
          (entry) => {
            const {
              created_at: _created,
              updated_at: _updated,
              ...untimed
            } = entry
            return untimed
          }
        )
        for (const entry of rawAcknowledgement)
          entries.set(entry.id, { ...entry })
        return rawAcknowledgement as unknown as typeof created
      })
    flush.mockImplementation(async () => {
      for (const [id, entry] of entries)
        entries.set(id, {
          ...entry,
          created_at: new Date("2026-10-09T03:00:00.000Z"),
          updated_at: new Date("2026-10-09T03:00:00.000Z"),
        })
    })
    const input = {
      content: "<p>Native timestamps</p>",
      title: "Native timestamps",
      expectedVersion: 0 as const,
      idempotencyKey: randomUUID(),
    }
    const committed = await createNewsEntry(requestFixture(), service, input)
    expect(rawAcknowledgement[0]?.created_at).toBeUndefined()
    expect(committed.entry.createdAt).toBe("2026-10-09T03:00:00.000Z")
    expect(committed.entry.updatedAt).toBe("2026-10-09T03:00:00.000Z")
    expect(service.retrieveNewsEntry).toHaveBeenCalledWith(
      committed.entry.id,
      {},
      context
    )
    expect(flush.mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(service.retrieveNewsEntry).mock.invocationCallOrder[0]!
    )
    expect(operations.get(input.idempotencyKey)?.result).toMatchObject({
      entry: committed.entry,
    })
    expect(await createNewsEntry(requestFixture(), service, input)).toEqual({
      entry: committed.entry,
      replayed: true,
    })
    expect(flush).toHaveBeenCalledTimes(1)
    expect(service.createNewsEntries).toHaveBeenCalledTimes(1)
  })

  it.each(["update", "archive", "restore"] as const)(
    "records native post-flush updated_at for %s",
    async (command) => {
      const original = newsRecord(
        command === "restore"
          ? { archived_at: new Date("2026-08-01T01:00:00.000Z") }
          : {}
      )
      const { entries, operations, service, flush } = serviceFixture([original])
      const nativeUpdate = jest
        .mocked(service.updateNewsEntries)
        .getMockImplementation()!
      let rawUpdatedAt: NewsEntryRecord["updated_at"]
      jest
        .mocked(service.updateNewsEntries)
        .mockImplementation(async (...args) => {
          const response = await nativeUpdate(...args)
          const rows = (Array.isArray(response) ? response : [response]).map(
            (entry) => ({ ...entry, updated_at: original.updated_at })
          ) as NewsEntryRecord[]
          rawUpdatedAt = rows[0]?.updated_at
          for (const entry of rows) entries.set(entry.id, { ...entry })
          return rows as typeof response
        })
      flush.mockImplementation(async () => {
        const entry = entries.get(original.id)!
        entries.set(original.id, {
          ...entry,
          updated_at: new Date("2026-10-09T03:01:00.000Z"),
        })
      })
      const input = { expectedVersion: 1, idempotencyKey: randomUUID() }
      const committed =
        command === "update"
          ? await updateNewsEntry(requestFixture(), service, original.id, {
              ...input,
              title: "Native update timestamp",
            })
          : await setNewsEntryArchived(
              requestFixture(),
              service,
              original.id,
              input,
              command === "archive"
            )
      expect(rawUpdatedAt).toEqual(original.updated_at)
      expect(committed.entry.updatedAt).toBe("2026-10-09T03:01:00.000Z")
      expect(operations.get(input.idempotencyKey)?.result).toMatchObject({
        entry: committed.entry,
      })
      expect(flush).toHaveBeenCalledTimes(1)
    }
  )

  it("rejects a failed native flush before command completion", async () => {
    const { operations, service, flush } = serviceFixture()
    const error = new Error("Owned native flush failed")
    flush.mockRejectedValueOnce(error)
    await expect(
      createNewsEntry(requestFixture(), service, {
        content: "<p>Must roll back</p>",
        title: "Must roll back",
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
      })
    ).rejects.toBe(error)
    expect(service.updateNewsOperations).not.toHaveBeenCalled()
    expect(
      [...operations.values()].every(
        (operation) => operation.status === "pending"
      )
    ).toBe(true)
  })

  it.each([
    undefined,
    null,
    {},
    { actor_id: "user_admin" },
    { actor_id: "user_admin", actor_type: "customer" },
    { actor_id: null, actor_type: "user" },
    { actor_id: 1, actor_type: "user" },
    { actor_id: "user_", actor_type: "user" },
    { actor_id: "user_other", actor_type: "user" },
  ])(
    "rejects native actor %p before direct-helper transaction or lookup",
    async (context) => {
      const original = newsRecord()
      const { entries, operations, service } = serviceFixture([original])
      const req = {
        ...requestFixture(),
        auth_context: context,
      } as unknown as MedusaRequest
      await expect(
        updateNewsEntry(req, service, original.id, {
          expectedActorId: "user_admin",
          expectedVersion: 1,
          idempotencyKey: randomUUID(),
          title: "Updated title",
        })
      ).rejects.toThrow()
      expect(req.scope.resolve).not.toHaveBeenCalled()
      for (const method of Object.values(service)) {
        expect(method).not.toHaveBeenCalled()
      }
      expect(entries.get(original.id)).toEqual(original)
      expect(operations.size).toBe(0)
    }
  )

  it.each([null, "", " user_admin", 1, {}])(
    "rejects malformed direct-helper actor precondition %p without writes",
    async (expectedActorId) => {
      const { operations, service } = serviceFixture([newsRecord()])
      await expect(
        updateNewsEntry(requestFixture(), service, "news_existing", {
          expectedActorId,
          expectedVersion: 1,
          idempotencyKey: randomUUID(),
          title: "Updated title",
        } as unknown as NewsUpdateInput)
      ).rejects.toThrow("Invalid news actor precondition.")
      for (const method of Object.values(service)) {
        expect(method).not.toHaveBeenCalled()
      }
      expect(operations.size).toBe(0)
    }
  )

  it.each([false, true])(
    "keeps legacy update hashes and replay compatible when guarded first is %p",
    async (guardedFirst) => {
      const { operations, service } = serviceFixture([newsRecord()])
      const legacyInput = {
        content: '<p>Updated body</p><script>alert("x")</script>',
        expectedVersion: 1,
        idempotencyKey: randomUUID(),
        publishedAt: null,
        status: "published" as const,
        tags: ["News", "news"],
        title: "Updated title",
      }
      const guardedInput = { ...legacyInput, expectedActorId: "user_admin" }
      const committed = await updateNewsEntry(
        requestFixture(),
        service,
        "news_existing",
        guardedFirst ? guardedInput : legacyInput
      )
      const expectedHash = hashCatalogCommand({
        aggregateId: "news_existing",
        command: "news.entry.update",
        expectedVersion: 1,
        payload: legacyInput,
      })
      expect(operations.get(legacyInput.idempotencyKey)).toMatchObject({
        actor_id: "user_admin",
        request_sha256: expectedHash,
        status: "succeeded",
      })
      expect(committed.entry).toMatchObject({
        author: "Original Author",
        content: "<p>Updated body</p>",
        id: "news_existing",
        status: "published",
        tags: ["News"],
        version: 2,
      })
      expect(committed.entry.publishedAt).not.toBeNull()
      await expect(
        updateNewsEntry(
          requestFixture(),
          service,
          "news_existing",
          guardedFirst ? legacyInput : guardedInput
        )
      ).resolves.toEqual({ ...committed, replayed: true })
      expect(operations.size).toBe(1)
      expect(service.createNewsOperations).toHaveBeenCalledTimes(1)
      expect(service.updateNewsEntries).toHaveBeenCalledTimes(1)
    }
  )

  it.each(["user_admin", "user_other"])(
    "rejects another actor's existing command with precondition %s",
    async (expectedActorId) => {
      const { entries, operations, service } = serviceFixture([newsRecord()])
      const input = {
        expectedActorId: "user_admin",
        expectedVersion: 1,
        idempotencyKey: randomUUID(),
        title: "Updated title",
      }
      await updateNewsEntry(requestFixture(), service, "news_existing", input)
      const savedEntries = structuredClone([...entries])
      const savedOperations = structuredClone([...operations])
      const lookupCount = (service.listNewsOperations as jest.Mock).mock.calls
        .length
      const transactionCount = (service.runNewsTransaction as jest.Mock).mock
        .calls.length
      await expect(
        updateNewsEntry(
          requestFixture("user_other"),
          service,
          "news_existing",
          {
            ...input,
            expectedActorId,
          }
        )
      ).rejects.toThrow(
        expectedActorId === "user_admin"
          ? "The signed-in administrator changed."
          : "The news idempotency key cannot be replayed"
      )
      expect(service.listNewsOperations).toHaveBeenCalledTimes(
        lookupCount + Number(expectedActorId === "user_other")
      )
      expect(service.runNewsTransaction).toHaveBeenCalledTimes(
        transactionCount + Number(expectedActorId === "user_other")
      )
      expect([...entries]).toEqual(savedEntries)
      expect([...operations]).toEqual(savedOperations)
      expect(service.updateNewsEntries).toHaveBeenCalledTimes(1)
      expect(service.createNewsOperations).toHaveBeenCalledTimes(1)
    }
  )

  it("does not count the actor precondition as a content change", async () => {
    const { service } = serviceFixture([newsRecord()])
    await expect(
      updateNewsEntry(requestFixture(), service, "news_existing", {
        expectedActorId: "user_admin",
        expectedVersion: 1,
        idempotencyKey: randomUUID(),
      })
    ).rejects.toThrow("No news changes were provided.")
    for (const method of Object.values(service)) {
      expect(method).not.toHaveBeenCalled()
    }
  })

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
    entries.set(
      createdRecord.id,
      newsRecord({
        ...createdRecord,
        title: "Changed later",
        version: 2,
      })
    )
    const replayRequest = requestFixture()
    ;(replayRequest.scope.resolve as jest.Mock).mockImplementation(() => {
      throw new Error("Author lookup must not run during an exact replay")
    })
    const replayed = await createNewsEntry(replayRequest, service, input)
    expect(replayed).toEqual({ ...created, replayed: true })
    expect(entries.size).toBe(1)
    expect(service.listNewsOperations).toHaveBeenCalledWith(
      { idempotency_key: idempotencyKey },
      { take: 2 },
      expect.anything()
    )
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
    expect(service.listNewsEntries).toHaveBeenCalledWith(
      expect.objectContaining({ slug: expect.any(String) }),
      { take: 2 },
      expect.anything()
    )
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

  it("replays a lost Publish acknowledgement after another writer archives the current projection", async () => {
    const { entries, operations, service } = serviceFixture([newsRecord()])
    const actor = requestFixture()
    const input = {
      content: '<p>Published body</p><script>alert("removed")</script>',
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
      publishedAt: null,
      status: "published" as const,
      tags: ["News", "news"],
      title: "Published acknowledgement",
    }
    const committed = await updateNewsEntry(
      actor,
      service,
      "news_existing",
      input
    )
    expect(committed.entry).toMatchObject({
      content: "<p>Published body</p>",
      status: "published",
      tags: ["News"],
      version: 2,
    })
    expect(committed.entry.publishedAt).not.toBeNull()
    const operationBeforeLaterWrite = structuredClone(
      operations.get(input.idempotencyKey)
    )
    const archived = await setNewsEntryArchived(
      requestFixture("user_other_writer"),
      service,
      "news_existing",
      { expectedVersion: 2, idempotencyKey: randomUUID() },
      true
    )
    expect(archived.entry).toMatchObject({ status: "archived", version: 3 })
    const writes = jest.mocked(service.updateNewsEntries).mock.calls.length

    const replayed = await updateNewsEntry(
      actor,
      service,
      "news_existing",
      input
    )
    expect(replayed).toEqual({ ...committed, replayed: true })
    expect(entries.get("news_existing")).toMatchObject({
      status: "published",
      version: 3,
      archived_at: expect.any(Date),
    })
    expect(jest.mocked(service.updateNewsEntries)).toHaveBeenCalledTimes(writes)
    expect(operations.get(input.idempotencyKey)).toEqual(
      operationBeforeLaterWrite
    )

    for (const [request, changedInput] of [
      [requestFixture("user_other_writer"), input],
      [actor, { ...input, expectedVersion: 2 }],
      [actor, { ...input, title: "A different command" }],
    ] as const) {
      await expect(
        updateNewsEntry(request, service, "news_existing", changedInput)
      ).rejects.toThrow("cannot be replayed")
    }
    expect(jest.mocked(service.updateNewsEntries)).toHaveBeenCalledTimes(writes)
  })

  it("replays an exact scheduled command after its date passes without permitting a new past schedule", async () => {
    jest.useFakeTimers({ now: new Date("2030-01-01T00:00:00.000Z") })
    try {
      const { operations, service } = serviceFixture([newsRecord()])
      const input = {
        expectedVersion: 1,
        idempotencyKey: randomUUID(),
        publishedAt: "2030-01-02T12:00:00.000Z",
        status: "scheduled" as const,
      }
      const committed = await updateNewsEntry(
        requestFixture(),
        service,
        "news_existing",
        input
      )
      const receipt = structuredClone(operations.get(input.idempotencyKey))
      jest.setSystemTime(new Date("2030-01-03T00:00:00.000Z"))
      await expect(
        updateNewsEntry(requestFixture(), service, "news_existing", input)
      ).resolves.toEqual({ ...committed, replayed: true })
      await expect(
        updateNewsEntry(requestFixture(), service, "news_existing", {
          ...input,
          expectedVersion: 2,
          idempotencyKey: randomUUID(),
        })
      ).rejects.toThrow("future publication date")
      expect(operations.get(input.idempotencyKey)).toEqual(receipt)
      expect(service.updateNewsEntries).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it("rejects a malformed entry creation acknowledgement", async () => {
    const { service } = serviceFixture()
    ;(service.createNewsEntries as jest.Mock).mockResolvedValue([
      newsRecord({ id: "news_created", version: 0 }),
    ])

    await expect(
      createNewsEntry(requestFixture(), service, {
        content: "<p>Body</p>",
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
        title: "Invalid acknowledgement",
      })
    ).rejects.toThrow(
      "The Admin content persistence boundary returned invalid structured data."
    )
    expect(service.updateNewsOperations).not.toHaveBeenCalled()
  })

  it("rejects a malformed operation completion acknowledgement", async () => {
    const { service } = serviceFixture()
    ;(service.updateNewsOperations as jest.Mock).mockResolvedValue([false])

    await expect(
      createNewsEntry(requestFixture(), service, {
        content: "<p>Body</p>",
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
        title: "Invalid audit acknowledgement",
      })
    ).rejects.toThrow(
      "The Admin content persistence boundary returned invalid structured data."
    )
  })

  it("rejects unintended persisted fields after a valid native identity acknowledgement", async () => {
    const { entries, service } = serviceFixture()
    const nativeCreate = jest
      .mocked(service.createNewsEntries)
      .getMockImplementation()!
    jest
      .mocked(service.createNewsEntries)
      .mockImplementation(async (...args) => {
        const created = await nativeCreate(...args)
        const rows = (Array.isArray(created) ? created : [created]).map(
          (entry) => ({ ...entry, title: "Unexpected title" })
        )
        for (const row of rows) entries.set(row.id, row)
        return rows as typeof created
      })

    await expect(
      createNewsEntry(requestFixture(), service, {
        content: "<p>Body</p>",
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
        title: "Expected title",
      })
    ).rejects.toThrow(
      "The Admin content persistence boundary returned invalid structured data."
    )
    expect(service.retrieveNewsEntry).toHaveBeenCalledTimes(1)
    expect([...entries.values()][0]?.title).toBe("Unexpected title")
    expect(service.updateNewsOperations).not.toHaveBeenCalled()
  })

  it("rejects a changed entry during the final durable readback", async () => {
    const { entries, service } = serviceFixture()
    let reads = 0
    ;(service.retrieveNewsEntry as jest.Mock).mockImplementation(
      async (id: string) => {
        const persisted = entries.get(id)
        reads += 1
        return persisted && reads > 1
          ? { ...persisted, title: "Changed during commit" }
          : (persisted ?? null)
      }
    )

    await expect(
      createNewsEntry(requestFixture(), service, {
        content: "<p>Body</p>",
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
        title: "Expected title",
      })
    ).rejects.toThrow(
      "The Admin content persistence boundary returned invalid structured data."
    )
    expect(service.retrieveNewsEntry).toHaveBeenCalledTimes(2)
    expect(service.updateNewsOperations).toHaveBeenCalledTimes(1)
  })

  it("rejects duplicate durable idempotency rows", async () => {
    const { operations, service } = serviceFixture()
    const idempotencyKey = randomUUID()
    const input = {
      content: "<p>Body</p>",
      expectedVersion: 0 as const,
      idempotencyKey,
      title: "Expected title",
    }
    await createNewsEntry(requestFixture(), service, input)
    const persisted = operations.get(idempotencyKey)
    if (!persisted) {
      throw new Error("Expected the persisted News operation")
    }
    ;(service.listNewsOperations as jest.Mock).mockResolvedValue([
      persisted,
      { ...persisted, id: "newsop_duplicate" },
    ])

    await expect(
      createNewsEntry(requestFixture(), service, input)
    ).rejects.toThrow(
      "The Admin content persistence boundary returned invalid structured data."
    )
  })

  it("rejects a mismatched slug lookup row", async () => {
    const { service } = serviceFixture()
    ;(service.listNewsEntries as jest.Mock).mockResolvedValue([
      newsRecord({ slug: "different-slug" }),
    ])

    await expect(
      createNewsEntry(requestFixture(), service, {
        content: "<p>Body</p>",
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
        title: "Expected title",
      })
    ).rejects.toThrow(
      "The Admin content persistence boundary returned invalid structured data."
    )
  })
})
