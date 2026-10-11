import type { FetchArgs } from "@medusajs/js-sdk"
import { buildNewsEntryPatch } from "../../../api/admin/news/entry-payload"
import {
  serializeNewsEntry,
  type NewsEntryRecord,
} from "../../../modules/news/serializers"
import { AdminRequestError, type AdminSdkClient } from "../../lib/admin-request"
import { writeAdminFormDraft } from "../../lib/admin-form-draft"
import {
  beginNewsCommand,
  clearResolvedNewsCommand,
  finishNewsCommand,
  newsCommandStorageKey,
  MAX_NEWS_COMMAND_BYTES,
  readSavedNewsCommand,
  restoreNewsCommand,
  retryNewsCommand,
  saveNewsCommand,
  scheduleNewsRestore,
  type NewsCommandBoundary,
} from "./news-command-state"
import {
  buildNewsWriteInput,
  newsEditorDraftSchema,
  type NewsEditorValues,
} from "./news-form-state"

const nonce = "00000000-0000-4000-8000-000000000001"
const origin = "https://admin.example.test"
const values: NewsEditorValues = {
  title: "Owned News recovery",
  content: "<p>Owned body</p>",
  excerpt: "Owned summary",
  coverUrl: "",
  coverAltText: "",
  tagsText: "Recovery",
  scheduleAt: "2035-01-02T12:00",
}
const record = (): NewsEntryRecord => ({
  id: "news_owned_recovery",
  archived_at: null,
  author: "Owned author",
  content: "<p>Owned body</p>",
  cover_alt_text: null,
  cover_url: null,
  created_at: new Date("2030-01-01T00:00:00.000Z"),
  updated_at: new Date("2030-01-01T00:00:00.000Z"),
  excerpt: "Owned summary",
  published_at: null,
  seo_description: "Owned summary",
  seo_title: "Owned News recovery · Remorseless Records",
  slug: "owned-news-recovery",
  status: "draft",
  tags: ["Recovery"],
  title: "Owned News recovery",
  version: 7,
})
const context = { backendOrigin: origin, entryId: record().id }
const snapshot = () => serializeNewsEntry(record())
const acknowledgement = (
  intent: "draft" | "schedule" | "publish" = "publish",
  replayed = false
) => ({
  entry: serializeNewsEntry({
    ...record(),
    ...buildNewsEntryPatch({
      existing: record(),
      input: {
        ...buildNewsWriteInput(values, intent),
        expectedVersion: 7,
        idempotencyKey: nonce,
      },
      now: new Date("2030-01-01T12:00:00.000Z"),
    }),
    version: 8,
  }),
  replayed,
})
const storage = () => {
  const values = new Map<string, string>()
  return {
    values,
    getItem: jest.fn((key: string) => values.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => {
      values.set(key, value)
    }),
    removeItem: jest.fn((key: string) => {
      values.delete(key)
    }),
  }
}
const locks = () => {
  let busy = false
  return {
    request: jest.fn(
      async (
        _name: string,
        _options: unknown,
        fn: (lock: object | null) => Promise<unknown>
      ) => {
        if (busy) return fn(null)
        busy = true
        try {
          return await fn({})
        } finally {
          busy = false
        }
      }
    ),
  } as unknown as NonNullable<NewsCommandBoundary["locks"]>
}
const boundary = (
  handler: (
    path: unknown,
    request?: FetchArgs
  ) => Promise<unknown> = async () => acknowledgement()
) => ({
  storage: storage(),
  locks: locks(),
  client: {
    fetch: jest.fn(async (path: unknown, request?: FetchArgs) =>
      path === "/admin/users/me"
        ? { user: { id: "user_original" } }
        : handler(path, request)
    ) as AdminSdkClient["fetch"],
  },
})
const begin = (
  state: NewsCommandBoundary,
  intent: "draft" | "schedule" | "publish" = "publish"
) =>
  beginNewsCommand(
    context,
    snapshot(),
    buildNewsWriteInput(values, intent),
    intent,
    nonce,
    state
  )
const putCalls = (state: ReturnType<typeof boundary>) =>
  jest
    .mocked(state.client.fetch)
    .mock.calls.filter(([, request]) => request?.method === "PUT")
const uncertain = () =>
  boundary(async () => {
    throw new AdminRequestError("Lost reply", "timeout")
  })

describe("News command recovery authority", () => {
  it.each(["draft", "schedule"] as const)(
    "does not confirm a rejected %s command from another writer's matching projection",
    async (intent) => {
      const error = new AdminRequestError("Stale expected version", "http", 409)
      const state = boundary(async () => {
        throw error
      })
      const result = await begin(state, intent)
      expect(result.error).toBe(error)
      expect(result.record.status).toBe("rejected")
      expect(putCalls(state)).toHaveLength(1)
      expect(state.client.fetch).not.toHaveBeenCalledWith(
        `/admin/news/${context.entryId}`,
        expect.objectContaining({ method: "GET" })
      )
    }
  )
  it("does not confirm an unchanged draft after two failed attempts", async () => {
    const state = uncertain()
    const result = await begin(state, "draft")
    expect(result.record.status).toBe("uncertain")
    expect(result.error).toMatchObject({ kind: "timeout" })
    expect(putCalls(state)).toHaveLength(2)
    expect(readSavedNewsCommand(state.storage)?.body.idempotencyKey).toBe(nonce)
    await expect(
      clearResolvedNewsCommand(result.record, origin, state)
    ).rejects.toThrow("Only the exact confirmed")
    expect(state.storage.removeItem).not.toHaveBeenCalled()
  })
  it("recovers Publish's actual server timestamp through its identical command acknowledgement", async () => {
    let sent = 0
    const committed = acknowledgement()
    const state = boundary(async (_path, request) => {
      expect(readSavedNewsCommand(state.storage)?.body).toEqual(request?.body)
      if (++sent === 1)
        throw new AdminRequestError("Lost committed reply", "timeout")
      return { ...committed, replayed: true }
    })
    const result = await begin(state)
    expect(result.record.status).toBe("confirmed")
    expect(result.record.body.publishedAt).toBeNull()
    expect(result.record.acknowledgement?.entry.publishedAt).toBe(
      "2030-01-01T12:00:00.000Z"
    )
    expect(result.record.acknowledgement?.replayed).toBe(true)
    expect(putCalls(state).map(([, request]) => request?.body)).toEqual([
      result.record.body,
      result.record.body,
    ])
    expect(state.client.fetch).toHaveBeenCalledTimes(4)
    await clearResolvedNewsCommand(result.record, origin, state)
    expect(readSavedNewsCommand(state.storage)).toBeNull()
  })
  it("allows the captured repeat to first commit if the initial request never reached the server", async () => {
    let calls = 0
    const state = boundary(async () => {
      if (++calls === 1)
        throw new AdminRequestError("Network unavailable", "unknown")
      return acknowledgement()
    })
    expect((await begin(state)).record.acknowledgement?.replayed).toBe(false)
    expect(putCalls(state)).toHaveLength(2)
  })
  it.each([400, 401, 403, 404, 409, 422, 429])(
    "does not automatically repeat first definitive HTTP%s",
    async (status) => {
      const error = new AdminRequestError("Rejected", "http", status)
      const state = boundary(async () => {
        throw error
      })
      const result = await begin(state)
      expect(result).toMatchObject({ record: { status: "rejected" }, error })
      expect(putCalls(state)).toHaveLength(1)
      await clearResolvedNewsCommand(result.record, origin, state)
      expect(readSavedNewsCommand(state.storage)).toBeNull()
    }
  )
  it.each([401, 403, 409, 429, 503])(
    "retains earlier uncertainty when its repeat gets HTTP%s",
    async (status) => {
      let calls = 0
      const state = boundary(async () => {
        if (++calls === 1) throw new AdminRequestError("Lost reply", "timeout")
        throw new AdminRequestError("Retry rejected", "http", status)
      })
      const result = await begin(state)
      expect(result.record.status).toBe("uncertain")
      expect(result.error).toMatchObject({ status })
      expect(readSavedNewsCommand(state.storage)).toEqual(result.record)
      expect(putCalls(state)).toHaveLength(2)
    }
  )
  it("does not automatically repeat cancellation or discard its uncertainty", async () => {
    const state = boundary(async () => {
      throw new AdminRequestError("Cancelled", "cancelled")
    })
    expect((await begin(state)).record.status).toBe("uncertain")
    expect(putCalls(state)).toHaveLength(1)
  })
  it("restores exact body/version/UUID after reload and retains historical acknowledgement after later changes", async () => {
    const first = uncertain()
    const saved = (await begin(first)).record
    const renewed = boundary(async () => acknowledgement("publish", true))
    renewed.storage = first.storage
    const restored = await restoreNewsCommand(origin, renewed)
    expect(restored).toEqual(saved)
    expect(putCalls(renewed)).toHaveLength(0)
    if (!restored) throw new Error("Expected saved command")
    const result = await retryNewsCommand(restored, origin, renewed)
    expect(result.record.acknowledgement).toEqual(
      acknowledgement("publish", true)
    )
    expect(putCalls(renewed)[0]?.[1]?.body).toEqual(saved.body)
    expect(result.record.body.expectedVersion).toBe(7)
    expect(result.record.acknowledgement?.entry.version).toBe(8)
  })
  it("retries an elapsed captured schedule without rebuilding it or changing UUID", async () => {
    const state = uncertain()
    const saved = (await begin(state, "schedule")).record
    jest.useFakeTimers({ now: new Date("2040-01-01T00:00:00.000Z") })
    try {
      const renewed = boundary(async () => acknowledgement("schedule", true))
      renewed.storage = state.storage
      expect(
        (await retryNewsCommand(saved, origin, renewed)).record.status
      ).toBe("confirmed")
      expect(putCalls(renewed)[0]?.[1]?.body).toEqual(saved.body)
    } finally {
      jest.useRealTimers()
    }
  })
  it("never sends the saved body under another native administrator", async () => {
    const state = uncertain()
    const saved = (await begin(state)).record
    const other = boundary()
    other.storage = state.storage
    jest
      .mocked(other.client.fetch)
      .mockResolvedValue({ user: { id: "user_other" } } as never)
    await expect(restoreNewsCommand(origin, other)).rejects.toThrow(
      "another server or administrator"
    )
    await expect(retryNewsCommand(saved, origin, other)).rejects.toThrow(
      "another server or administrator"
    )
    await expect(
      clearResolvedNewsCommand(saved, origin, other)
    ).rejects.toThrow()
    expect(putCalls(other)).toHaveLength(0)
    expect(readSavedNewsCommand(other.storage)).toEqual(saved)
  })
  it("blocks actor switches before the automatic repeat", async () => {
    const state = boundary()
    let actors = 0
    jest.mocked(state.client.fetch).mockImplementation(async (path) => {
      if (path === "/admin/users/me")
        return {
          user: { id: ++actors === 1 ? "user_original" : "user_other" },
        } as never
      throw new AdminRequestError("Lost reply", "timeout")
    })
    const result = await begin(state)
    expect(result.record.status).toBe("uncertain")
    expect(result.record.body.expectedActorId).toBe("user_original")
    expect(putCalls(state)).toHaveLength(1)
  })
  it("keeps another-origin or corrupt saved identity without deleting it", async () => {
    const state = uncertain()
    const saved = (await begin(state)).record
    await expect(
      retryNewsCommand(saved, "https://other.example.test", state)
    ).rejects.toThrow("another server")
    state.storage.values.set(
      newsCommandStorageKey,
      JSON.stringify({ ...saved, body: { ...saved.body, expectedVersion: 8 } })
    )
    await expect(restoreNewsCommand(origin, state)).rejects.toThrow()
    expect(state.storage.removeItem).not.toHaveBeenCalled()
  })
  it("refuses new UUID/body while any saved request remains", async () => {
    const state = uncertain()
    const saved = (await begin(state)).record
    await expect(
      beginNewsCommand(
        context,
        snapshot(),
        { ...buildNewsWriteInput(values, "publish"), title: "Different" },
        "publish",
        "00000000-0000-4000-8000-000000000002",
        state
      )
    ).rejects.toThrow("already saved")
    expect(readSavedNewsCommand(state.storage)).toEqual(saved)
    expect(putCalls(state)).toHaveLength(2)
  })
  it("requires durable storage and Web Locks before sending", async () => {
    const state = boundary()
    state.storage.setItem.mockImplementation(() => {
      throw new Error("Storage denied")
    })
    await expect(begin(state)).rejects.toThrow("Storage denied")
    await expect(begin({ ...state, locks: undefined })).rejects.toThrow(
      "coordinate"
    )
    expect(putCalls(state)).toHaveLength(0)
  })
  it("supports reviewed multibyte HTML limits in all three durable snapshots", async () => {
    const content = `<p>${"界".repeat(90_000)}</p>`
    const loaded = { ...snapshot(), content }
    const body = { ...buildNewsWriteInput(values, "publish"), content }
    const state = boundary(async () => ({
      ...acknowledgement(),
      entry: { ...acknowledgement().entry, content },
    }))
    const result = await beginNewsCommand(
      context,
      loaded,
      body,
      "publish",
      nonce,
      state
    )
    expect(result.record.status).toBe("confirmed")
    const serialized = state.storage.values.get(newsCommandStorageKey)
    expect(serialized).toBeDefined()
    const bytes = new TextEncoder().encode(serialized).length
    expect(bytes).toBeGreaterThan(512 * 1_024)
    expect(bytes).toBeLessThan(MAX_NEWS_COMMAND_BYTES)
    expect(readSavedNewsCommand(state.storage)?.body.content).toBe(content)
  })
  it("retains oversize untrusted recovery data instead of truncating or deleting it", async () => {
    const state = boundary()
    state.storage.values.set(
      newsCommandStorageKey,
      "x".repeat(MAX_NEWS_COMMAND_BYTES + 1)
    )
    await expect(restoreNewsCommand(origin, state)).rejects.toThrow("too large")
    expect(state.storage.removeItem).not.toHaveBeenCalled()
    expect(putCalls(state)).toHaveLength(0)
  })
  it("serializes tabs without overwriting the command", async () => {
    let release: ((value: unknown) => void) | undefined
    const state = boundary(
      async () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    const first = begin(state)
    while (!release) await Promise.resolve()
    await expect(begin(state)).rejects.toThrow("Another tab")
    release(acknowledgement())
    expect((await first).record.status).toBe("confirmed")
    expect(putCalls(state)).toHaveLength(1)
  })
  it.each(["id", "version", "status", "publishedAt"] as const)(
    "retains mismatched %s acknowledgement uncertainty",
    async (field) => {
      const invalid = acknowledgement()
      Object.assign(invalid.entry, {
        [field]: {
          id: "news_other",
          version: 9,
          status: "draft",
          publishedAt: null,
        }[field],
      })
      const state = boundary(async () => invalid)
      expect((await begin(state)).record.status).toBe("uncertain")
      expect(putCalls(state)).toHaveLength(2)
    }
  )
  it.each([
    ["title", "Other writer"],
    ["content", "<p>Other body</p>"],
    ["excerpt", "Other summary"],
    ["coverUrl", "https://images.example.test/other.webp"],
    ["coverAltText", "Other cover"],
    ["tags", ["Other"]],
  ] as const)(
    "retains uncertainty for a wrong %s body acknowledgement",
    async (field, value) => {
      const invalid = acknowledgement()
      Object.assign(invalid.entry, { [field]: value })
      const state = boundary(async () => invalid)
      expect((await begin(state)).record.status).toBe("uncertain")
      expect(putCalls(state)).toHaveLength(2)
      expect(state.storage.removeItem).not.toHaveBeenCalled()
    }
  )
  it("accepts server canonicalization of the original HTML, nullable fields and ordered tags", async () => {
    const body = {
      ...buildNewsWriteInput(values, "publish"),
      content: '<p>Owned body</p><script>alert("discarded")</script>',
      excerpt: " Owned summary ",
      tags: ["Recovery", "recovery"],
      coverAltText: "Discarded without a cover",
    }
    const state = boundary(async () => acknowledgement())
    const result = await beginNewsCommand(
      context,
      snapshot(),
      body,
      "publish",
      nonce,
      state
    )
    expect(result.record.status).toBe("confirmed")
    expect(result.record.body.content).toBe(body.content)
    expect(result.record.acknowledgement?.entry.content).toBe(
      "<p>Owned body</p>"
    )
  })
  it("requires an already published edit to preserve the original publication timestamp", async () => {
    const loaded = {
      ...snapshot(),
      status: "published" as const,
      publishedAt: "2029-01-01T00:00:00.000Z",
    }
    const state = boundary(async () => acknowledgement())
    expect(
      (
        await beginNewsCommand(
          context,
          loaded,
          buildNewsWriteInput(values, "publish"),
          "publish",
          nonce,
          state
        )
      ).record.status
    ).toBe("uncertain")
  })
  it("keeps late server success when editor epoch changes", async () => {
    let current = true
    const state = boundary(async () => {
      current = false
      return acknowledgement()
    })
    const result = await begin({ ...state, isCurrent: () => current })
    expect(result.record.status).toBe("uncertain")
    expect(result.error).toMatchObject({ kind: "cancelled" })
    expect(putCalls(state)).toHaveLength(1)
    expect(readSavedNewsCommand(state.storage)?.body.idempotencyKey).toBe(nonce)
  })
  it("never downgrades or changes acknowledged historical results", async () => {
    const state = boundary()
    const saved = (await begin(state)).record
    expect(saved.status).toBe("confirmed")
    expect(() =>
      saveNewsCommand(
        { ...saved, status: "uncertain", acknowledgement: null },
        state.storage
      )
    ).toThrow("cannot become uncertain")
    expect(() =>
      saveNewsCommand(
        { ...saved, acknowledgement: acknowledgement("publish", true) },
        state.storage
      )
    ).toThrow("cannot change")
  })
  it("clears only an acknowledged matching browser draft after recovery", async () => {
    const state = boundary()
    writeAdminFormDraft({
      key: `admin:news:${context.entryId}`,
      schema: newsEditorDraftSchema,
      values,
      storage: state.storage,
    })
    const saved = (await begin(state)).record
    await finishNewsCommand(saved, origin, state, async () => {})
    expect(state.storage.getItem(`admin:news:${context.entryId}`)).toBeNull()
    expect(readSavedNewsCommand(state.storage)).toBeNull()
  })
  it("preserves a newer different browser draft and all initially rejected drafts", async () => {
    for (const rejected of [false, true]) {
      const state = boundary(async () => {
        if (rejected) throw new AdminRequestError("Rejected", "http", 409)
        return acknowledgement()
      })
      writeAdminFormDraft({
        key: `admin:news:${context.entryId}`,
        schema: newsEditorDraftSchema,
        values: {
          ...values,
          title: rejected ? values.title : "Newer local edit",
        },
        storage: state.storage,
      })
      const raw = state.storage.getItem(`admin:news:${context.entryId}`)
      const saved = (await begin(state)).record
      await finishNewsCommand(saved, origin, state, async () => {})
      expect(state.storage.getItem(`admin:news:${context.entryId}`)).toBe(raw)
    }
  })
  it("keeps the confirmed acknowledgement when current-list refresh rejects", async () => {
    const state = boundary()
    const saved = (await begin(state)).record
    const failure = new Error("List unavailable")
    await expect(
      finishNewsCommand(saved, origin, state, async () => {
        throw failure
      })
    ).rejects.toBe(failure)
    expect(readSavedNewsCommand(state.storage)).toEqual(saved)
    expect(state.storage.removeItem).not.toHaveBeenCalled()
    await finishNewsCommand(saved, origin, state, async () => {})
    expect(readSavedNewsCommand(state.storage)).toBeNull()
  })
  it("keeps confirmed recovery when the component epoch changes during refresh", async () => {
    const state = boundary()
    const saved = (await begin(state)).record
    let current = true
    await expect(
      finishNewsCommand(
        saved,
        origin,
        { ...state, isCurrent: () => current },
        async () => {
          current = false
        }
      )
    ).rejects.toMatchObject({ kind: "cancelled" })
    expect(readSavedNewsCommand(state.storage)).toEqual(saved)
    expect(state.storage.removeItem).not.toHaveBeenCalled()
  })
  it("defers obsolete initial restoration before its actor lock", async () => {
    const state = boundary()
    let epoch = 1
    const restore = jest.fn(async () => {
      await restoreNewsCommand(origin, state)
    })
    const stale = scheduleNewsRestore(() => epoch === 1, restore)
    epoch = 2
    await Promise.all([stale, scheduleNewsRestore(() => epoch === 2, restore)])
    expect(restore).toHaveBeenCalledTimes(1)
    expect(state.client.fetch).toHaveBeenCalledTimes(1)
    expect(state.storage.setItem).not.toHaveBeenCalled()
  })
})
