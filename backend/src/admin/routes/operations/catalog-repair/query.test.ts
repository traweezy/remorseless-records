import { FetchError, type FetchArgs } from "@medusajs/js-sdk"

import type { AdminSdkClient } from "../../../lib/admin-request"
import {
  fetchRepairActor,
  fetchRepairPreview,
  postRepair,
  repairContextSchema,
  repairPreviewSchema,
  type RepairBody,
  type RepairPreview,
  type RepairResult,
} from "./query"

const context = {
  backendOrigin: "https://admin.example.test",
  creationOperationId: "catop_creation",
  productId: "prod_missing",
  sha: "a".repeat(40),
}
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
const body: RepairBody = {
  productId: context.productId,
  sha: context.sha,
  expectedActorId: "user_original",
  expectedManifestSha256: "b".repeat(64),
  idempotencyKey: "79368c83-8dc1-443a-9b96-2a92a6e9b0cb",
}
const reply: RepairResult = {
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
}
const clientWith = (
  handler: (path: unknown, request?: FetchArgs) => Promise<unknown>
): AdminSdkClient => ({
  fetch: jest.fn(handler) as AdminSdkClient["fetch"],
})

describe("failed-creation repair response boundaries", () => {
  it("checks the actual current user before the exact strict preview GET", async () => {
    const client = clientWith(async (path) =>
      path === "/admin/users/me"
        ? { user: { id: "user_original", email: "not-stored@example.test" } }
        : preview()
    )
    await expect(fetchRepairPreview(context, { client })).resolves.toEqual(
      preview()
    )
    expect(client.fetch).toHaveBeenNthCalledWith(
      1,
      "/admin/users/me",
      expect.objectContaining({ method: "GET" })
    )
    expect(client.fetch).toHaveBeenNthCalledWith(
      2,
      "/admin/catalog/failed-creations/catop_creation",
      expect.objectContaining({
        method: "GET",
        query: { productId: context.productId, sha: context.sha },
      })
    )
  })

  it.each([
    [
      "actor",
      (value: RepairPreview) => {
        value.actorId = "user_switched"
      },
    ],
    [
      "product",
      (value: RepairPreview) => {
        value.manifest.productId = "prod_other"
      },
    ],
    [
      "creation",
      (value: RepairPreview) => {
        value.manifest.creationOperationId = "catop_other"
        value.manifest.creation.id = "catop_other"
      },
    ],
  ] as const)(
    "rejects a preview with changed %s authority or target",
    async (_label, change) => {
      const value = preview()
      change(value)
      const client = clientWith(async (path) =>
        path === "/admin/users/me" ? { user: { id: "user_original" } } : value
      )
      await expect(
        fetchRepairPreview(context, { client })
      ).rejects.toMatchObject({ kind: "invalid-response" })
    }
  )

  it.each([
    [
      "native absence",
      (value: RepairPreview) => {
        Object.assign(value.manifest, { nativeProductAbsent: false })
      },
    ],
    [
      "variant absence",
      (value: RepairPreview) => {
        value.manifest.nativeVariantsAbsent = ["variant_other"]
      },
    ],
    [
      "asset ownership",
      (value: RepairPreview) => {
        const row = value.manifest.media[0]
        if (!row) throw new Error("Missing fixture media")
        row.assetId = "cmedia_other"
      },
    ],
    [
      "duplicate records",
      (value: RepairPreview) => {
        const row = value.manifest.media[0]
        if (!row) throw new Error("Missing fixture media")
        value.manifest.media.push(row)
      },
    ],
    [
      "child count",
      (value: RepairPreview) => {
        value.manifest.children.pop()
      },
    ],
    [
      "unknown property",
      (value: RepairPreview) => {
        Object.assign(value.manifest, { rawProviderDetails: "not-accepted" })
      },
    ],
    [
      "fingerprint",
      (value: RepairPreview) => {
        value.manifestSha256 = "z".repeat(64)
      },
    ],
    [
      "child commands",
      (value: RepairPreview) => {
        const row = value.manifest.children[0]
        if (!row) throw new Error("Missing fixture child")
        row.command = "catalog.variant-profile.upsert"
      },
    ],
    [
      "parent as child",
      (value: RepairPreview) => {
        const row = value.manifest.children[0]
        if (!row) throw new Error("Missing fixture child")
        row.id = value.manifest.creationOperationId
      },
    ],
  ] as const)(
    "rejects malformed %s in the destructive plan",
    (_label, change) => {
      const value = preview()
      change(value)
      expect(repairPreviewSchema.safeParse(value).success).toBe(false)
    }
  )

  it.each([
    "https://admin.example.test/path",
    "https://user:password@admin.example.test",
    "javascript:alert(1)",
  ])("rejects a non-origin server binding %s", (backendOrigin) => {
    expect(
      repairContextSchema.safeParse({ ...context, backendOrigin }).success
    ).toBe(false)
  })

  it("drops a stale session response before requesting its preview", async () => {
    let current = true
    const client = clientWith(async () => {
      current = false
      return { user: { id: "user_original" } }
    })
    await expect(
      fetchRepairPreview(context, { client, isCurrent: () => current })
    ).rejects.toMatchObject({ kind: "cancelled" })
    expect(client.fetch).toHaveBeenCalledTimes(1)
  })

  it("drops a stale preview response after the target changed", async () => {
    let current = true
    const client = clientWith(async (path) => {
      if (path === "/admin/users/me") return { user: { id: "user_original" } }
      current = false
      return preview()
    })
    await expect(
      fetchRepairPreview(context, { client, isCurrent: () => current })
    ).rejects.toMatchObject({ kind: "cancelled" })
  })

  it("uses the existing SDK to send the exact reviewed POST body", async () => {
    const client = clientWith(async () => reply)
    await expect(postRepair(context, body, { client })).resolves.toEqual(reply)
    expect(client.fetch).toHaveBeenCalledWith(
      "/admin/catalog/failed-creations/catop_creation",
      expect.objectContaining({ method: "POST", body })
    )
  })

  it.each([
    { ...body, productId: "prod_other" },
    { ...body, sha: "f".repeat(40) },
  ])("does not send a body outside its bound context", async (request) => {
    const client = clientWith(async () => reply)
    await expect(postRepair(context, request, { client })).rejects.toThrow(
      "does not match"
    )
    expect(client.fetch).not.toHaveBeenCalled()
  })

  it("does not send a stale mutation even if its schema is valid", async () => {
    const client = clientWith(async () => reply)
    await expect(
      postRepair(context, body, { client, isCurrent: () => false })
    ).rejects.toMatchObject({ kind: "cancelled" })
    expect(client.fetch).not.toHaveBeenCalled()
  })

  it("rejects a malformed acknowledgment rather than claiming success", async () => {
    const client = clientWith(async () => ({
      operationId: "catop_repair",
      replayed: true,
    }))
    await expect(postRepair(context, body, { client })).rejects.toMatchObject({
      kind: "invalid-response",
    })
  })

  it.each([401, 403, 409, 429, 503])(
    "preserves actual native/limiter HTTP %s without a fabricated success",
    async (status) => {
      const client = clientWith(async () => {
        throw new FetchError("Native rejection", "Error", status)
      })
      await expect(postRepair(context, body, { client })).rejects.toMatchObject(
        { kind: "http", status }
      )
    }
  )

  it("never derives an actor from email, a missing user, or a non-user identity", async () => {
    const client = clientWith(async () => ({
      user: { email: "admin@example.test", id: "cus_not_an_admin" },
    }))
    await expect(fetchRepairActor({ client })).rejects.toMatchObject({
      kind: "invalid-response",
    })
  })
})
