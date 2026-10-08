import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

import {
  deriveCatalogCommandIdempotencyKey,
  hashCatalogCommand,
} from "../../modules/catalog/catalog-command"
import {
  inspectFailedCatalogCreation,
  repairFailedCatalogCreation,
} from "./failed-creation-repair"
import {
  catalogMediaAssetFixture,
  catalogOperationFixture,
  catalogProductMediaItemFixture,
  catalogProductProfileFixture,
} from "./transaction-persistence-fixtures.test-helpers"

const identity = { creationOperationId: "catop_parent", productId: "prod_1" }
const parentKey = "00000000-0000-4000-8000-000000000001"
const repairKey = "00000000-0000-4000-8000-000000000002"
const authority = { actorId: "user_operator", source: "admin_http" } as const

const fixture = () => {
  const context = { transactionManager: { owned: true } }
  const profile = catalogProductProfileFixture()
  const variant = {
    availability_status: "in_stock",
    backorder_allowed: false,
    backorder_note: null,
    created_at: "2026-08-30T00:00:00.000Z",
    display_label: "CD",
    format_detail_id: null,
    format_detail_label: null,
    format_id: null,
    format_label: null,
    id: "cvprof_1",
    image_url: null,
    metadata: {},
    preorder_allowed: false,
    preorder_release_date: null,
    product_profile_id: profile.id,
    updated_at: "2026-08-30T00:00:00.000Z",
    variant_id: "variant_1",
    version: 1,
  }
  const media = catalogProductMediaItemFixture()
  const asset = catalogMediaAssetFixture()
  const history = [
    catalogOperationFixture({
      id: identity.creationOperationId,
      command: "catalog.product.create",
      aggregate_id: `catalog-product-create:${parentKey}`,
      idempotency_key: parentKey,
      status: "compensated",
    }),
    catalogOperationFixture({
      id: "catop_profile",
      command: "catalog.product-profile.upsert",
      idempotency_key: deriveCatalogCommandIdempotencyKey(
        parentKey,
        "product-profile"
      ),
      status: "succeeded",
      result: {
        profileId: profile.id,
        productId: identity.productId,
        version: 1,
        created: true,
      },
    }),
    catalogOperationFixture({
      id: "catop_media",
      idempotency_key: deriveCatalogCommandIdempotencyKey(
        parentKey,
        "product-media"
      ),
      status: "succeeded",
      result: { productId: identity.productId, version: 1 },
    }),
    catalogOperationFixture({
      id: "catop_variant",
      command: "catalog.variant-profile.upsert",
      aggregate_id: variant.variant_id,
      idempotency_key: "00000000-0000-4000-8000-000000000003",
      status: "succeeded",
      result: {
        profileId: variant.id,
        variantId: variant.variant_id,
        version: 1,
        created: true,
      },
    }),
  ]
  const operations = [...history]
  let deleted = false
  const catalog = {
    runCatalogTransaction: jest.fn(
      async (job: (value: unknown) => Promise<unknown>) => job(context)
    ),
    listCatalogAuthoringOperations: jest.fn(
      async (filter: Record<string, unknown>) =>
        operations.filter((row) => {
          if (filter.idempotency_key)
            return row.idempotency_key === filter.idempotency_key
          const key = filter.id ? "id" : "aggregate_id"
          const values = Array.isArray(filter[key])
            ? filter[key]
            : [filter[key]]
          return values.includes(row[key])
        })
    ),
    listCatalogProductProfiles: jest.fn(async () => (deleted ? [] : [profile])),
    listCatalogVariantProfiles: jest.fn(async () => (deleted ? [] : [variant])),
    listCatalogProductMediaItems: jest.fn(async () => (deleted ? [] : [media])),
    listCatalogMediaAssets: jest.fn(async () => [asset]),
    listCatalogBundleProfiles: jest.fn(async () => []),
    listCatalogProductArtists: jest.fn(async () => []),
    listCatalogProductReferences: jest.fn(async () => []),
    listCatalogShelfProducts: jest.fn(async () => []),
    createCatalogAuthoringOperations: jest.fn(
      async (rows: Record<string, unknown>[]) => {
        const added = rows.map((row) => ({ ...row, id: "catop_repair" }))
        operations.push(...added)
        return added
      }
    ),
    softDeleteCatalogProductMediaItems: jest.fn(async () => undefined),
    softDeleteCatalogVariantProfiles: jest.fn(async () => undefined),
    softDeleteCatalogProductProfiles: jest.fn(async () => {
      deleted = true
    }),
    completeCatalogAuthoringOperation: jest.fn(
      async (id: string, result: Record<string, unknown>) => {
        const row = operations.find((operation) => operation.id === id)!
        Object.assign(row, {
          result,
          status: "succeeded",
          completed_at: "2026-08-30T00:05:00.000Z",
        })
      }
    ),
  }
  const products = {
    listProducts: jest.fn(async () => []),
    listProductVariants: jest.fn(async () => []),
  }
  const resolve = jest.fn((key: string) => {
    if (key === "catalog") return catalog
    if (key === Modules.PRODUCT) return products
    throw new Error(`Unexpected repair dependency ${key}`)
  })
  return {
    catalog,
    products,
    history,
    operations,
    asset,
    profile,
    container: { resolve } as unknown as MedusaContainer,
    context,
  }
}

describe("trusted failed-creation repair authority", () => {
  it.each([undefined, authority])(
    "retains ownership/history/assets while binding optional authority %j",
    async (trusted) => {
      const { container, catalog, asset, history, operations, context } =
        fixture()
      const retainedHistory = structuredClone(history)
      const retainedAsset = structuredClone(asset)
      const preview = await inspectFailedCatalogCreation(container, identity)
      const input = {
        ...identity,
        expectedManifestSha256: preview.manifestSha256,
        idempotencyKey: repairKey,
      }
      const repaired = await repairFailedCatalogCreation(
        container,
        input,
        trusted
      )
      expect(repaired.replayed).toBe(false)
      expect(asset).toEqual(retainedAsset)
      expect(history).toEqual(retainedHistory)
      expect(catalog.createCatalogAuthoringOperations).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            actor_id: trusted?.actorId ?? null,
            metadata: {
              source: trusted?.source ?? "operator_cli",
              creation_operation_id: identity.creationOperationId,
            },
            request_sha256: hashCatalogCommand(
              trusted ? { command: input, authority: trusted } : input
            ),
          }),
        ],
        context
      )
      const beforeReplay = catalog.listCatalogProductProfiles.mock.calls.length
      expect(
        await repairFailedCatalogCreation(container, input, trusted)
      ).toEqual({ ...repaired, replayed: true })
      expect(catalog.listCatalogProductProfiles).toHaveBeenCalledTimes(
        beforeReplay
      )
      expect(catalog.createCatalogAuthoringOperations).toHaveBeenCalledTimes(1)
      expect(operations).toHaveLength(5)
      expect(catalog.softDeleteCatalogProductMediaItems).toHaveBeenCalledWith(
        ["cpmedia_1"],
        {},
        context
      )
      expect(catalog.softDeleteCatalogVariantProfiles).toHaveBeenCalledWith(
        ["cvprof_1"],
        {},
        context
      )
      expect(catalog.softDeleteCatalogProductProfiles).toHaveBeenCalledWith(
        ["cprof_1"],
        {},
        context
      )
      if (trusted) {
        for (const changed of [
          undefined,
          { ...authority, actorId: "user_other" },
        ])
          await expect(
            repairFailedCatalogCreation(container, input, changed)
          ).rejects.toMatchObject({ type: "conflict" })
        expect(catalog.createCatalogAuthoringOperations).toHaveBeenCalledTimes(
          1
        )
      } else {
        await expect(
          repairFailedCatalogCreation(container, input, authority)
        ).rejects.toMatchObject({ type: "conflict" })
      }
    }
  )
  it.each([
    { actor_id: "user_other" },
    { metadata: { source: "operator_cli" } },
    { expected_version: 0 },
  ])(
    "rejects tampered Admin ledger authority despite a matching command hash %j",
    async (change) => {
      const { container, catalog, operations } = fixture()
      const preview = await inspectFailedCatalogCreation(container, identity)
      const input = {
        ...identity,
        expectedManifestSha256: preview.manifestSha256,
        idempotencyKey: repairKey,
      }
      await repairFailedCatalogCreation(container, input, authority)
      Object.assign(operations.at(-1)!, change)
      await expect(
        repairFailedCatalogCreation(container, input, authority)
      ).rejects.toMatchObject({ type: "conflict" })
      expect(catalog.createCatalogAuthoringOperations).toHaveBeenCalledTimes(1)
    }
  )
  it("rejects authority in public command data and malformed trusted identities before resolving a module", async () => {
    const { container } = fixture()
    const input = {
      ...identity,
      expectedManifestSha256: "a".repeat(64),
      idempotencyKey: repairKey,
    }
    await expect(
      repairFailedCatalogCreation(container, {
        ...input,
        actorId: "user_spoof",
      } as typeof input)
    ).rejects.toThrow()
    await expect(
      repairFailedCatalogCreation(container, input, {
        ...authority,
        actorId: "key_other",
      })
    ).rejects.toThrow()
    expect(container.resolve).not.toHaveBeenCalled()
  })
  it("rejects a stale reviewed manifest before any repair audit or deletion", async () => {
    const { container, catalog } = fixture()
    await expect(
      repairFailedCatalogCreation(
        container,
        {
          ...identity,
          expectedManifestSha256: "f".repeat(64),
          idempotencyKey: repairKey,
        },
        authority
      )
    ).rejects.toMatchObject({ type: "conflict" })
    expect(catalog.createCatalogAuthoringOperations).not.toHaveBeenCalled()
    expect(catalog.softDeleteCatalogProductMediaItems).not.toHaveBeenCalled()
  })
})
