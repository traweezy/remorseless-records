import { type FetchArgs } from "@medusajs/js-sdk"

import { AdminRequestError, type AdminSdkClient } from "../../lib/admin-request"
import {
  beginGallery,
  clearConfirmedGallery,
  galleryProjectionMatches,
  galleryStorageKey,
  readSavedGallery,
  restoreGallery,
  retryGallery,
  saveGallery,
  scheduleGalleryRestore,
  type GalleryBoundary,
  type SavedGallery,
} from "./product-gallery-command-state"
import { type ProductGallery } from "./product-gallery-query"

const nonce = "00000000-0000-4000-8000-000000000001"
const context = {
  productId: "product_acceptance",
  backendOrigin: "https://admin.example.test",
}
const snapshot = (): ProductGallery => ({
  productId: context.productId,
  version: 4,
  media: [
    {
      id: "link_original",
      productId: context.productId,
      variantId: null,
      productProfileId: "profile_acceptance",
      mediaAssetId: "asset_original",
      role: "primary",
      sortOrder: 7,
      isPrimary: true,
      metadata: { retained: ["original"] },
      asset: {
        id: "asset_original",
        sourceUrl: "https://images.example.test/original.webp",
        altText: "Original artwork",
        originalFilename: "original.webp",
        lifecycleStatus: "active",
        version: 9,
      },
    },
  ],
})
const projection = (): ProductGallery => ({
  ...snapshot(),
  version: 5,
  media: snapshot().media.map((item) => ({ ...item, id: "link_replaced" })),
})
const memoryStorage = () => {
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
const exclusiveLocks = () => {
  const busy = new Set<string>()
  const request = jest.fn(
    async (
      name: string,
      _options: unknown,
      callback: (lock: { name: string } | null) => Promise<unknown>
    ) => {
      if (busy.has(name)) return callback(null)
      busy.add(name)
      try {
        return await callback({ name })
      } finally {
        busy.delete(name)
      }
    }
  )
  return { request } as unknown as NonNullable<GalleryBoundary["locks"]>
}
const boundaryWith = (
  handler: (path: unknown, request?: FetchArgs) => Promise<unknown> = async (
    path
  ) =>
    path === "/admin/users/me"
      ? { user: { id: "user_original" } }
      : projection()
) => ({
  storage: memoryStorage(),
  locks: exclusiveLocks(),
  client: { fetch: jest.fn(handler) as AdminSdkClient["fetch"] },
})
const begin = (boundary: GalleryBoundary, uuid: () => string = () => nonce) =>
  beginGallery(
    context,
    snapshot(),
    snapshot().media,
    "profile_acceptance",
    [],
    boundary,
    uuid
  )
const broken = async (path: unknown) => {
  if (path === "/admin/users/me") return { user: { id: "user_original" } }
  throw new AdminRequestError("Response lost", "timeout")
}
const uncertain = async (
  boundary = boundaryWith(broken)
): Promise<SavedGallery> => (await begin(boundary)).record
const putCalls = (boundary: ReturnType<typeof boundaryWith>) =>
  (boundary.client.fetch as jest.Mock).mock.calls.filter(
    ([, request]) => request?.method === "PUT"
  )

describe("durable actor-bound managed gallery commands", () => {
  it("defers only the obsolete StrictMode restore and obtains one native actor read", async () => {
    const boundary = boundaryWith()
    let epoch = 1
    const restore = jest.fn(async () => {
      await restoreGallery(context, boundary)
    })
    const stale = scheduleGalleryRestore(() => epoch === 1, restore)
    epoch = 2
    const current = scheduleGalleryRestore(() => epoch === 2, restore)
    await Promise.all([stale, current])
    expect(restore).toHaveBeenCalledTimes(1)
    expect(boundary.client.fetch).toHaveBeenCalledTimes(1)
    expect(boundary.storage.setItem).not.toHaveBeenCalled()
  })

  it("persists and reads back the immutable request before the first PUT", async () => {
    const boundary = boundaryWith(async (path, request) => {
      if (path === "/admin/users/me") return { user: { id: "user_original" } }
      const saved = readSavedGallery(context.productId, boundary.storage)
      expect(saved?.status).toBe("uncertain")
      expect(saved?.body).toEqual(request?.body)
      expect(saved?.body).toMatchObject({
        expectedActorId: "user_original",
        expectedVersion: 4,
        idempotencyKey: nonce,
      })
      expect(saved?.body.media[0]).toMatchObject({
        sortOrder: 7,
        metadata: { retained: ["original"] },
      })
      return projection()
    })
    const result = await begin(boundary)
    expect(result.error).toBeUndefined()
    expect(result.record.status).toBe("confirmed")
    expect(result.record.projection).toEqual(projection())
    expect(readSavedGallery(context.productId, boundary.storage)).toEqual(
      result.record
    )
    expect(putCalls(boundary)).toHaveLength(1)
  })

  it.each([401, 403, 404, 409, 429, 500])(
    "retains exact body and UUID after uncertain HTTP %s",
    async (status) => {
      const boundary = boundaryWith(async (path) => {
        if (path === "/admin/users/me") return { user: { id: "user_original" } }
        throw new AdminRequestError("Unconfirmed", "http", status)
      })
      const result = await begin(boundary)
      expect(result.error).toMatchObject({ status })
      expect(result.record.status).toBe("uncertain")
      expect(
        readSavedGallery(context.productId, boundary.storage)?.body
      ).toEqual(result.record.body)
      expect(boundary.storage.removeItem).not.toHaveBeenCalled()
    }
  )

  it.each([
    { ...projection(), version: 6 },
    { ...projection(), media: [] },
    {
      ...projection(),
      media: projection().media.map((item) => ({ ...item, sortOrder: 8 })),
    },
    {
      ...projection(),
      media: projection().media.map((item) => ({
        ...item,
        metadata: { retained: ["changed"] },
      })),
    },
    { productId: "another_product", version: 5, media: [] },
    { version: 5 },
  ])(
    "does not infer historical success from a changed or invalid current projection %#",
    async (reply) => {
      const boundary = boundaryWith(async (path) =>
        path === "/admin/users/me" ? { user: { id: "user_original" } } : reply
      )
      const result = await begin(boundary)
      expect(result.error).toBeDefined()
      expect(result.record.status).toBe("uncertain")
      expect(result.record.projection).toBeNull()
      expect(
        readSavedGallery(context.productId, boundary.storage)?.body
          .expectedVersion
      ).toBe(4)
    }
  )

  it("retries only the persisted exact body/key and never reads or rebases the gallery", async () => {
    const boundary = boundaryWith(broken)
    const first = await uncertain(boundary)
    const original = putCalls(boundary)[0]![1].body
    ;(boundary.client.fetch as jest.Mock).mockImplementation(async (path) =>
      path === "/admin/users/me"
        ? { user: { id: "user_original" } }
        : projection()
    )
    const result = await retryGallery(first, context, boundary)
    expect(result.record.status).toBe("confirmed")
    expect(putCalls(boundary).map(([, request]) => request.body)).toEqual([
      original,
      original,
    ])
    expect(
      (boundary.client.fetch as jest.Mock).mock.calls
        .filter(([path]) => path !== "/admin/users/me")
        .every(([, request]) => request.method === "PUT")
    ).toBe(true)
  })

  it("allows an explicit same-key verification after confirmation without a new UUID", async () => {
    const boundary = boundaryWith()
    const first = (await begin(boundary)).record
    const result = await retryGallery(first, context, boundary)
    expect(result.record.body).toEqual(first.body)
    expect(result.record.status).toBe("confirmed")
    expect(putCalls(boundary)).toHaveLength(2)
  })

  it("does not erase a prior confirmation when its later replay sees a newer gallery", async () => {
    const boundary = boundaryWith()
    const first = (await begin(boundary)).record
    ;(boundary.client.fetch as jest.Mock).mockImplementation(async (path) =>
      path === "/admin/users/me"
        ? { user: { id: "user_original" } }
        : { ...projection(), version: 6 }
    )
    const result = await retryGallery(first, context, boundary)
    expect(result.error).toBeDefined()
    expect(result.record).toEqual(first)
    expect(readSavedGallery(context.productId, boundary.storage)).toEqual(first)
  })

  it.each(["retry", "restore", "clear"])(
    "holds %s for a changed administrator",
    async (action) => {
      const boundary = boundaryWith()
      const first = (await begin(boundary)).record
      ;(boundary.client.fetch as jest.Mock).mockImplementation(async () => ({
        user: { id: "user_different" },
      }))
      const operation =
        action === "retry"
          ? retryGallery(first, context, boundary)
          : action === "clear"
            ? clearConfirmedGallery(first, context, boundary)
            : restoreGallery(context, boundary)
      await expect(operation).rejects.toThrow("another server or administrator")
      expect(putCalls(boundary)).toHaveLength(1)
      expect(boundary.storage.removeItem).not.toHaveBeenCalled()
    }
  )

  it("holds a changed origin and preserves another product's request", async () => {
    const boundary = boundaryWith()
    const first = (await begin(boundary)).record
    await expect(
      retryGallery(
        first,
        { ...context, backendOrigin: "https://other.example.test" },
        boundary
      )
    ).rejects.toThrow("another server")
    expect(galleryStorageKey("another_product")).not.toBe(
      galleryStorageKey(context.productId)
    )
    expect(readSavedGallery("another_product", boundary.storage)).toBeNull()
    expect(readSavedGallery(context.productId, boundary.storage)).toEqual(first)
  })

  it("keeps an uncertain request when the native session expires before retry", async () => {
    const boundary = boundaryWith(broken)
    const first = await uncertain(boundary)
    ;(boundary.client.fetch as jest.Mock).mockImplementation(async () => {
      throw new AdminRequestError("Sign in again", "http", 401)
    })
    await expect(retryGallery(first, context, boundary)).rejects.toMatchObject({
      status: 401,
    })
    expect(readSavedGallery(context.productId, boundary.storage)).toEqual(first)
    expect(putCalls(boundary)).toHaveLength(1)
    expect(boundary.storage.removeItem).not.toHaveBeenCalled()
  })

  it("only clears a confirmed immutable request after verifying its native owner", async () => {
    const boundary = boundaryWith()
    const first = (await begin(boundary)).record
    await clearConfirmedGallery(first, context, boundary)
    expect(readSavedGallery(context.productId, boundary.storage)).toBeNull()
    expect(boundary.storage.removeItem).toHaveBeenCalledWith(
      galleryStorageKey(context.productId)
    )
    const unknown = await uncertain(boundaryWith(broken))
    const other = boundaryWith(broken)
    saveGallery(unknown, other.storage)
    await expect(
      clearConfirmedGallery(unknown, context, other)
    ).rejects.toThrow("Only a confirmed")
    expect(readSavedGallery(context.productId, other.storage)).toEqual(unknown)
  })

  it.each([
    "bad JSON",
    JSON.stringify({ version: 0 }),
    "x".repeat(256 * 1_024 + 1),
  ])(
    "keeps an invalid or oversized record without expiring or replacing it",
    async (raw) => {
      const boundary = boundaryWith()
      boundary.storage.values.set(galleryStorageKey(context.productId), raw)
      await expect(restoreGallery(context, boundary)).rejects.toThrow()
      await expect(begin(boundary)).rejects.toThrow()
      expect(
        boundary.storage.values.get(galleryStorageKey(context.productId))
      ).toBe(raw)
      expect(boundary.storage.removeItem).not.toHaveBeenCalled()
      expect(boundary.storage.setItem).not.toHaveBeenCalled()
      expect(putCalls(boundary)).toHaveLength(0)
    }
  )

  it.each(["read", "write", "readback"])(
    "sends no PUT when durable storage %s fails",
    async (failure) => {
      const boundary = boundaryWith()
      if (failure === "read")
        boundary.storage.getItem.mockImplementation(() => {
          throw new Error("Blocked")
        })
      if (failure === "write")
        boundary.storage.setItem.mockImplementation(() => {
          throw new Error("Full")
        })
      if (failure === "readback")
        boundary.storage.setItem.mockImplementation(() => {})
      await expect(begin(boundary)).rejects.toThrow()
      expect(putCalls(boundary)).toHaveLength(0)
    }
  )

  it("retains the sent uncertain record if the confirmation cannot be persisted", async () => {
    const boundary = boundaryWith()
    const write = boundary.storage.setItem.getMockImplementation()!
    boundary.storage.setItem.mockImplementation((key, raw) => {
      if (JSON.parse(raw).status === "confirmed")
        throw new Error("Storage full")
      write(key, raw)
    })
    const result = await begin(boundary)
    expect(result.error).toBeDefined()
    expect(result.record.status).toBe("uncertain")
    expect(readSavedGallery(context.productId, boundary.storage)?.body).toEqual(
      result.record.body
    )
    expect(putCalls(boundary)).toHaveLength(1)
  })

  it("sends nothing when native WebLocks are unavailable", async () => {
    const boundary = boundaryWith()
    await expect(begin({ ...boundary, locks: undefined })).rejects.toThrow(
      "coordinate"
    )
    expect(boundary.client.fetch).not.toHaveBeenCalled()
    expect(boundary.storage.setItem).not.toHaveBeenCalled()
  })

  it("keeps the lock through the response so another tab cannot generate another command", async () => {
    let finish!: (value: unknown) => void
    const pending = new Promise<unknown>((resolve) => {
      finish = resolve
    })
    const boundary = boundaryWith(async (path) =>
      path === "/admin/users/me" ? { user: { id: "user_original" } } : pending
    )
    const uuid = jest.fn(() => nonce)
    const first = begin(boundary, uuid)
    for (let turn = 0; turn < 50 && !putCalls(boundary).length; turn++)
      await Promise.resolve()
    expect(putCalls(boundary)).toHaveLength(1)
    await expect(begin(boundary, uuid)).rejects.toThrow("Another tab")
    expect(uuid).toHaveBeenCalledTimes(1)
    expect(putCalls(boundary)).toHaveLength(1)
    finish(projection())
    expect((await first).record.status).toBe("confirmed")
  })

  it("shows an already saved request without sending or generating a second UUID", async () => {
    const boundary = boundaryWith(broken)
    const first = await uncertain(boundary)
    const uuid = jest.fn(() => "another UUID must not be used")
    expect((await begin(boundary, uuid)).record).toEqual(first)
    expect(uuid).not.toHaveBeenCalled()
    expect(putCalls(boundary)).toHaveLength(1)
  })

  it("never overwrites immutable identity or retries a stale expected record", async () => {
    const boundary = boundaryWith(broken)
    const first = await uncertain(boundary)
    const altered = { ...first, body: { ...first.body, expectedVersion: 7 } }
    expect(() => saveGallery(altered, boundary.storage)).toThrow(
      "Another gallery request"
    )
    await expect(retryGallery(altered, context, boundary)).rejects.toThrow(
      "changed"
    )
    expect(putCalls(boundary)).toHaveLength(1)
    expect(readSavedGallery(context.productId, boundary.storage)).toEqual(first)
  })

  it("retains the saved request if a response arrives after its UI context changes", async () => {
    let active = true
    const boundary = boundaryWith(async (path) => {
      if (path === "/admin/users/me") return { user: { id: "user_original" } }
      active = false
      return projection()
    })
    const result = await begin({ ...boundary, isCurrent: () => active })
    expect(result.error).toMatchObject({ kind: "cancelled" })
    expect(result.record.status).toBe("uncertain")
    expect(
      readSavedGallery(context.productId, boundary.storage)?.body.idempotencyKey
    ).toBe(nonce)
  })

  it("does not send a gallery with injected assets, changed ownership or metadata", async () => {
    const boundary = boundaryWith()
    for (const patch of [
      { mediaAssetId: "injected" },
      { productProfileId: null },
      { metadata: { changed: true } },
      { variantId: "variant_unavailable" },
    ]) {
      const draft = snapshot().media.map((item) => ({ ...item, ...patch }))
      await expect(
        beginGallery(
          context,
          snapshot(),
          draft,
          "profile_acceptance",
          [],
          boundary
        )
      ).rejects.toThrow()
    }
    expect(boundary.client.fetch).not.toHaveBeenCalled()
    expect(boundary.storage.setItem).not.toHaveBeenCalled()
  })

  it("distinguishes a matching current projection from its historical operation proof", async () => {
    const boundary = boundaryWith(broken)
    const record = await uncertain(boundary)
    expect(galleryProjectionMatches(record, projection())).toBe(true)
    expect(record.projection).toBeNull()
    expect(record.status).toBe("uncertain")
  })
})
