import { FetchError, type FetchArgs } from "@medusajs/js-sdk"

import {
  AdminRequestError,
  type AdminSdkClient,
} from "../../../lib/admin-request"
import {
  beginRepair,
  catalogRepairStorageKey,
  clearConfirmedRepair,
  previewRepair,
  readSavedRepair,
  restoreRepair,
  retryRepair,
  saveRepair,
  scheduleRepairRestore,
  type RepairBoundary,
  type SavedRepair,
} from "./command-state"
import type { RepairPreview, RepairResult } from "./query"

const context = {
  backendOrigin: "https://admin.example.test",
  creationOperationId: "catop_creation",
  productId: "prod_missing",
  sha: "a".repeat(40),
}
const nonce = "00000000-0000-4000-8000-000000000001"
const preview = (): RepairPreview => ({
  actorId: "user_original",
  manifestSha256: "b".repeat(64),
  manifest: {
    schemaVersion: 1,
    creationOperationId: context.creationOperationId,
    productId: context.productId,
    nativeProductAbsent: true,
    nativeVariantsAbsent: ["variant_missing"],
    creation: {
      id: "catop_creation",
      status: "compensated",
      rowSha256: "c".repeat(64),
    },
    profile: { id: "cprof_leftover", version: 1, rowSha256: "d".repeat(64) },
    variants: [
      {
        id: "cvprof_leftover",
        variantId: "variant_missing",
        version: 1,
        rowSha256: "e".repeat(64),
      },
    ],
    media: [
      {
        id: "cpmedia_leftover",
        assetId: "cmedia_retained",
        rowSha256: "f".repeat(64),
      },
    ],
    assets: [{ id: "cmedia_retained", version: 2, rowSha256: "0".repeat(64) }],
    children: [
      {
        id: "catop_profile",
        command: "catalog.product-profile.upsert",
        status: "succeeded",
        rowSha256: "1".repeat(64),
      },
      {
        id: "catop_variant",
        command: "catalog.variant-profile.upsert",
        status: "succeeded",
        rowSha256: "2".repeat(64),
      },
      {
        id: "catop_media",
        command: "catalog.product-media.replace",
        status: "succeeded",
        rowSha256: "3".repeat(64),
      },
    ],
  },
})
const reply = (): RepairResult => ({
  operationId: "catop_repair",
  replayed: false,
  result: {
    creationOperationId: context.creationOperationId,
    productId: context.productId,
    manifestSha256: "b".repeat(64),
    profileId: "cprof_leftover",
    variantProfileIds: ["cvprof_leftover"],
    mediaLinkIds: ["cpmedia_leftover"],
    retainedAssetIds: ["cmedia_retained"],
  },
})
const clientWith = (
  handler: (path: unknown, request?: FetchArgs) => Promise<unknown>
): AdminSdkClient => ({ fetch: jest.fn(handler) as AdminSdkClient["fetch"] })
const memoryStorage = () => {
  const values = new Map<string, string>()
  return {
    getItem: jest.fn((key: string) => values.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => {
      values.set(key, value)
    }),
    removeItem: jest.fn((key: string) => {
      values.delete(key)
    }),
    values,
  }
}
const exclusiveLocks = () => {
  let busy = false
  const request = jest.fn(
    async (
      name: string,
      options: { mode: string; ifAvailable: boolean },
      callback: (lock: object | null) => Promise<unknown>
    ) => {
      expect(name).toBe(catalogRepairStorageKey)
      expect(options).toEqual({ mode: "exclusive", ifAvailable: true })
      if (busy) return callback(null)
      busy = true
      try {
        return await callback({ name })
      } finally {
        busy = false
      }
    }
  )
  return { request } as unknown as NonNullable<RepairBoundary["locks"]>
}
const boundaryWith = (
  handler: (path: unknown, request?: FetchArgs) => Promise<unknown>
) => ({
  storage: memoryStorage(),
  locks: exclusiveLocks(),
  client: clientWith(handler),
})
const brokenPost = async (path: unknown) => {
  if (path === "/admin/users/me") return { user: { id: "user_original" } }
  throw new AdminRequestError("Unconfirmed", "timeout")
}
const uncertain = async (
  boundary = boundaryWith(brokenPost)
): Promise<SavedRepair> =>
  (await beginRepair(context, preview(), boundary, () => nonce)).record

describe("durable Catalog repair identity", () => {
  it("invalidates the replayed initial mount before taking a lock or requesting its user", async () => {
    let epoch = 1
    let mounted = true
    const boundary = boundaryWith(async () => ({
      user: { id: "user_original" },
    }))
    const restore = jest.fn(async () => {
      await restoreRepair(context.backendOrigin, boundary)
    })
    const firstMount = scheduleRepairRestore(
      () => mounted && epoch === 1,
      restore
    )
    mounted = false
    epoch++
    mounted = true
    epoch++
    const finalMount = scheduleRepairRestore(
      () => mounted && epoch === 3,
      restore
    )
    await Promise.all([firstMount, finalMount])
    expect(restore).toHaveBeenCalledTimes(1)
    expect(boundary.locks.request).toHaveBeenCalledTimes(1)
    expect(boundary.client.fetch).toHaveBeenCalledTimes(1)
    expect(boundary.client.fetch).toHaveBeenCalledWith(
      "/admin/users/me",
      expect.objectContaining({ method: "GET" })
    )
    expect(boundary.storage.setItem).not.toHaveBeenCalled()
  })

  it("drops the queued initial restore entirely after an actual unmount", async () => {
    let mounted = true
    const boundary = boundaryWith(brokenPost)
    const pending = scheduleRepairRestore(
      () => mounted,
      async () => {
        await restoreRepair(context.backendOrigin, boundary)
      }
    )
    mounted = false
    await pending
    expect(boundary.locks.request).not.toHaveBeenCalled()
    expect(boundary.client.fetch).not.toHaveBeenCalled()
    expect(boundary.storage.setItem).not.toHaveBeenCalled()
  })
  it("persists and reads back one exact body before the first POST", async () => {
    let boundary: ReturnType<typeof boundaryWith>
    boundary = boundaryWith(async (path, request) => {
      if (path === "/admin/users/me")
        return {
          user: { id: "user_original", email: "never-persist@example.test" },
        }
      const saved = readSavedRepair(boundary.storage)
      expect(saved?.status).toBe("uncertain")
      expect(saved?.body).toEqual(request?.body)
      expect(saved?.body.idempotencyKey).toBe(nonce)
      expect(boundary.storage.getItem(catalogRepairStorageKey)).not.toContain(
        "never-persist"
      )
      return reply()
    })
    const uuid = jest.fn(() => nonce)
    const result = await beginRepair(context, preview(), boundary, uuid)
    expect(result.record.status).toBe("succeeded")
    expect(result.error).toBeUndefined()
    expect(uuid).toHaveBeenCalledTimes(1)
    expect(boundary.client.fetch).toHaveBeenCalledTimes(2)
  })

  it.each([401, 403, 409, 429, 503])(
    "retains the exact body after HTTP %s, including limiter rejection",
    async (status) => {
      const boundary = boundaryWith(async (path) => {
        if (path === "/admin/users/me") return { user: { id: "user_original" } }
        throw new FetchError("Rejected", "Error", status)
      })
      const outcome = await beginRepair(
        context,
        preview(),
        boundary,
        () => nonce
      )
      expect(outcome.error).toMatchObject({ kind: "http", status })
      expect(readSavedRepair(boundary.storage)).toEqual(outcome.record)
      expect(outcome.record.status).toBe("uncertain")
      expect(boundary.storage.removeItem).not.toHaveBeenCalled()
    }
  )

  it.each(["timeout", "invalid-response", "unknown"] as const)(
    "preserves the immutable request after an ambiguous %s",
    async (kind) => {
      const boundary = boundaryWith(async (path) => {
        if (path === "/admin/users/me") return { user: { id: "user_original" } }
        throw new AdminRequestError("Unconfirmed", kind)
      })
      const result = await beginRepair(
        context,
        preview(),
        boundary,
        () => nonce
      )
      expect(result.record.status).toBe("uncertain")
      expect(result.error).toMatchObject({ kind })
      expect(readSavedRepair(boundary.storage)?.body.idempotencyKey).toBe(nonce)
    }
  )

  it("restores after reload and retries only the exact POST, without a new preview", async () => {
    const boundary = boundaryWith(brokenPost)
    const first = await uncertain(boundary)
    const retryClient = clientWith(async (path, request) => {
      if (path === "/admin/users/me") return { user: { id: "user_original" } }
      expect(request?.method).toBe("POST")
      expect(request?.body).toEqual(first.body)
      return { ...reply(), replayed: true }
    })
    const reloaded = { ...boundary, client: retryClient }
    const restored = await restoreRepair(context.backendOrigin, reloaded)
    expect(restored).toEqual(first)
    expect(retryClient.fetch).toHaveBeenCalledTimes(1)
    const result = await retryRepair(first, context.backendOrigin, reloaded)
    expect(result.record.status).toBe("succeeded")
    expect(result.record.result?.replayed).toBe(true)
    expect(retryClient.fetch).toHaveBeenCalledTimes(3)
    expect(retryClient.fetch).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ query: expect.anything() })
    )
  })

  it("keeps the cross-tab lock through late POST completion and refuses a second UUID", async () => {
    let complete!: (value: RepairResult) => void
    let entered!: () => void
    const sending = new Promise<void>((resolve) => {
      entered = resolve
    })
    const post = new Promise<RepairResult>((resolve) => {
      complete = resolve
    })
    const boundary = boundaryWith(async (path) => {
      if (path === "/admin/users/me") return { user: { id: "user_original" } }
      entered()
      return post
    })
    const first = beginRepair(context, preview(), boundary, () => nonce)
    await sending
    const secondUuid = jest.fn(() => "00000000-0000-4000-8000-000000000002")
    await expect(
      beginRepair(context, preview(), { ...boundary }, secondUuid)
    ).rejects.toThrow("Another tab")
    expect(secondUuid).not.toHaveBeenCalled()
    expect(boundary.client.fetch).toHaveBeenCalledTimes(2)
    complete(reply())
    expect((await first).record.status).toBe("succeeded")
  })

  it("shows another tab's saved uncertain plan without silently posting or replacing it", async () => {
    const boundary = boundaryWith(brokenPost)
    const first = await uncertain(boundary)
    const uuid = jest.fn(() => nonce)
    const second = await beginRepair(
      { ...context, productId: "prod_different" },
      {
        ...preview(),
        manifest: { ...preview().manifest, productId: "prod_different" },
      },
      boundary,
      uuid
    )
    expect(second.record).toEqual(first)
    expect(uuid).not.toHaveBeenCalled()
    expect(boundary.client.fetch).toHaveBeenCalledTimes(3)
    expect(readSavedRepair(boundary.storage)).toEqual(first)
  })

  it.each(["user_switched", "server"])(
    "does not expose, replace, or retry a saved request after a %s change",
    async (changed) => {
      const boundary = boundaryWith(brokenPost)
      const saved = await uncertain(boundary)
      const client = clientWith(async () => ({
        user: { id: changed === "server" ? "user_original" : changed },
      }))
      const switched = { ...boundary, client }
      const origin =
        changed === "server"
          ? "https://other.example.test"
          : context.backendOrigin
      await expect(restoreRepair(origin, switched)).rejects.toThrow(
        "another server or administrator"
      )
      await expect(retryRepair(saved, origin, switched)).rejects.toThrow(
        "another server or administrator"
      )
      expect(readSavedRepair(boundary.storage)).toEqual(saved)
      expect(client.fetch).toHaveBeenCalledTimes(2)
    }
  )

  it("rejects a changed actor between preview and apply before UUID generation or saving", async () => {
    const boundary = boundaryWith(async () => ({
      user: { id: "user_switched" },
    }))
    const uuid = jest.fn(() => nonce)
    await expect(
      beginRepair(context, preview(), boundary, uuid)
    ).rejects.toThrow("session or repair target changed")
    expect(uuid).not.toHaveBeenCalled()
    expect(boundary.storage.setItem).not.toHaveBeenCalled()
    expect(boundary.client.fetch).toHaveBeenCalledTimes(1)
  })

  it("drops an obsolete preflight response before saving or posting", async () => {
    let current = true
    const boundary = boundaryWith(async () => {
      current = false
      return { user: { id: "user_original" } }
    })
    await expect(
      beginRepair(
        context,
        preview(),
        { ...boundary, isCurrent: () => current },
        () => nonce
      )
    ).rejects.toMatchObject({ kind: "cancelled" })
    expect(boundary.storage.setItem).not.toHaveBeenCalled()
    expect(boundary.client.fetch).toHaveBeenCalledTimes(1)
  })

  it("retains a matching acknowledgment durably even when its page unmounts after sending", async () => {
    let current = true
    const boundary = boundaryWith(async (path) => {
      if (path === "/admin/users/me") return { user: { id: "user_original" } }
      current = false
      return reply()
    })
    const result = await beginRepair(
      context,
      preview(),
      { ...boundary, isCurrent: () => current },
      () => nonce
    )
    expect(result.record.status).toBe("succeeded")
    expect(readSavedRepair(boundary.storage)?.status).toBe("succeeded")
  })

  it("fails closed without Web Locks before any identity request or mutation", async () => {
    const boundary = boundaryWith(brokenPost)
    await expect(
      beginRepair(
        context,
        preview(),
        { ...boundary, locks: undefined },
        () => nonce
      )
    ).rejects.toThrow("safely coordinate")
    expect(boundary.client.fetch).not.toHaveBeenCalled()
    expect(boundary.storage.setItem).not.toHaveBeenCalled()
  })

  it("does not send when existing storage cannot be read, even with a valid current actor", async () => {
    const boundary = boundaryWith(brokenPost)
    boundary.storage.getItem.mockImplementation(() => {
      throw new Error("Storage blocked")
    })
    const uuid = jest.fn(() => nonce)
    await expect(
      beginRepair(context, preview(), boundary, uuid)
    ).rejects.toThrow("Storage blocked")
    expect(uuid).not.toHaveBeenCalled()
    expect(boundary.client.fetch).toHaveBeenCalledTimes(1)
    expect(boundary.storage.setItem).not.toHaveBeenCalled()
  })

  it("does not replace the saved request when its matching acknowledgment cannot be persisted", async () => {
    const boundary = boundaryWith(async (path) =>
      path === "/admin/users/me" ? { user: { id: "user_original" } } : reply()
    )
    const originalSet = boundary.storage.setItem.getMockImplementation()
    boundary.storage.setItem.mockImplementation((key, value) => {
      if (JSON.parse(value).status === "succeeded")
        throw new Error("Quota exceeded")
      originalSet?.(key, value)
    })
    const result = await beginRepair(context, preview(), boundary, () => nonce)
    expect(result.record.status).toBe("uncertain")
    expect(result.error).toBeInstanceOf(Error)
    expect(readSavedRepair(boundary.storage)?.body).toEqual(result.record.body)
    expect(readSavedRepair(boundary.storage)?.result).toBeNull()
  })

  it.each(["throw", "readback"])(
    "does not POST when durable storage %s fails",
    async (failure) => {
      const boundary = boundaryWith(brokenPost)
      boundary.storage.setItem.mockImplementation(() => {
        if (failure === "throw") throw new Error("Quota exceeded")
      })
      await expect(
        beginRepair(context, preview(), boundary, () => nonce)
      ).rejects.toThrow()
      expect(boundary.client.fetch).toHaveBeenCalledTimes(1)
    }
  )

  it.each([
    "not-json",
    "x".repeat(128 * 1_024 + 1),
    JSON.stringify({ version: 0, body: { idempotencyKey: nonce } }),
  ])(
    "preserves an unverifiable record and does not preview or mutate",
    async (raw) => {
      const boundary = boundaryWith(brokenPost)
      boundary.storage.values.set(catalogRepairStorageKey, raw)
      await expect(previewRepair(context, boundary)).rejects.toThrow()
      await expect(
        beginRepair(context, preview(), boundary, () => nonce)
      ).rejects.toThrow()
      expect(boundary.storage.values.get(catalogRepairStorageKey)).toBe(raw)
      expect(boundary.storage.setItem).not.toHaveBeenCalled()
      expect(boundary.storage.removeItem).not.toHaveBeenCalled()
      expect(boundary.client.fetch).toHaveBeenCalledTimes(1)
    }
  )

  it.each(["target", "hash", "profile", "variant", "media", "retained asset"])(
    "does not confirm a valid-looking acknowledgment with a different %s",
    async (changed) => {
      const value = reply()
      if (changed === "target") value.result.productId = "prod_other"
      if (changed === "hash") value.result.manifestSha256 = "f".repeat(64)
      if (changed === "profile") value.result.profileId = "cprof_other"
      if (changed === "variant")
        value.result.variantProfileIds = ["cvprof_other"]
      if (changed === "media") value.result.mediaLinkIds = ["cpmedia_other"]
      if (changed === "retained asset")
        value.result.retainedAssetIds = ["cmedia_other"]
      const boundary = boundaryWith(async (path) =>
        path === "/admin/users/me" ? { user: { id: "user_original" } } : value
      )
      const outcome = await beginRepair(
        context,
        preview(),
        boundary,
        () => nonce
      )
      expect(outcome.record.status).toBe("uncertain")
      expect(outcome.error).toMatchObject({ kind: "invalid-response" })
      expect(readSavedRepair(boundary.storage)?.result).toBeNull()
    }
  )

  it("will not overwrite, downgrade, or clear an uncertain identity", async () => {
    const boundary = boundaryWith(brokenPost)
    const saved = await uncertain(boundary)
    expect(() =>
      saveRepair(boundary.storage, {
        ...saved,
        body: {
          ...saved.body,
          idempotencyKey: "00000000-0000-4000-8000-000000000002",
        },
      })
    ).toThrow("already saved")
    await expect(
      clearConfirmedRepair(saved, context.backendOrigin, boundary)
    ).rejects.toThrow("Only a confirmed")
    expect(readSavedRepair(boundary.storage)).toEqual(saved)
  })

  it("does not repeat a confirmed POST, and clears it only after a fresh matching actor check", async () => {
    const boundary = boundaryWith(async (path) =>
      path === "/admin/users/me" ? { user: { id: "user_original" } } : reply()
    )
    const confirmed = (
      await beginRepair(context, preview(), boundary, () => nonce)
    ).record
    expect(() =>
      saveRepair(boundary.storage, {
        ...confirmed,
        status: "uncertain",
        result: null,
      })
    ).toThrow("cannot become")
    await expect(
      retryRepair(confirmed, context.backendOrigin, boundary)
    ).resolves.toEqual({ record: confirmed })
    expect(boundary.client.fetch).toHaveBeenCalledTimes(3)
    await clearConfirmedRepair(confirmed, context.backendOrigin, boundary)
    expect(boundary.client.fetch).toHaveBeenCalledTimes(4)
    expect(readSavedRepair(boundary.storage)).toBeNull()
  })
})
