import { MedusaError } from "@medusajs/framework/utils"

import {
  assertCatalogMediaAssetLock,
  assertCatalogMediaLockCoverage,
  findReusableCatalogMediaAsset,
  resolveCatalogProductMediaLockKeys,
} from "./product-media-locks"
import {
  catalogMediaAssetFixture,
  catalogOperationFixture,
  catalogProductMediaItemFixture,
} from "./transaction-persistence-fixtures.test-helpers"

const fixture = () => ({
  listCatalogAuthoringOperations: jest.fn().mockResolvedValue([]),
  listCatalogProductMediaItems: jest.fn().mockResolvedValue([]),
  listCatalogMediaAssets: jest.fn().mockResolvedValue([]),
})

describe("bounded shared Catalog media lease resolution", () => {
  const replayInput = {
    actorId: "user_1",
    aggregateId: "prod_1",
    command: "catalog.product-media.replace" as const,
    expectedVersion: 0,
    idempotencyKey: "00000000-0000-4000-8000-000000000001",
    requestSha256: "a".repeat(64),
    media: [{ sourceUrl: "https://media.example/url" }],
  }

  it("serializes an exact committed replay without discovering current or ambiguous desired sources", async () => {
    const catalog = fixture()
    catalog.listCatalogAuthoringOperations.mockResolvedValue([
      catalogOperationFixture({
        status: "succeeded",
        result: { productId: "prod_1", version: 1 },
      }),
    ])
    await expect(
      resolveCatalogProductMediaLockKeys(catalog as never, replayInput)
    ).resolves.toEqual(["catalog:product-media:prod_1"])
    expect(catalog.listCatalogProductMediaItems).not.toHaveBeenCalled()
    expect(catalog.listCatalogMediaAssets).not.toHaveBeenCalled()
  })

  it.each([
    { actor_id: "user_other" },
    { aggregate_id: "prod_other" },
    { command: "catalog.product-profile.upsert" },
    { expected_version: 1 },
    { idempotency_key: "00000000-0000-4000-8000-000000000002" },
    { request_sha256: "b".repeat(64) },
    { status: "pending" as const, result: {}, completed_at: null },
  ])("rejects a replay whose persisted binding differs: %j", async (drift) => {
    const catalog = fixture()
    catalog.listCatalogAuthoringOperations.mockResolvedValue([
      catalogOperationFixture({
        status: "succeeded",
        result: { productId: "prod_1", version: 1 },
        ...drift,
      }),
    ])
    await expect(
      resolveCatalogProductMediaLockKeys(catalog as never, replayInput)
    ).rejects.toThrow("cannot be replayed")
    expect(catalog.listCatalogMediaAssets).not.toHaveBeenCalled()
  })

  it("rejects a committed result from a different version before allowing replay", async () => {
    const catalog = fixture()
    catalog.listCatalogAuthoringOperations.mockResolvedValue([
      catalogOperationFixture({
        status: "succeeded",
        result: { productId: "prod_1", version: 2 },
      }),
    ])
    await expect(
      resolveCatalogProductMediaLockKeys(catalog as never, replayInput)
    ).rejects.toThrow("did not match")
  })

  it("combines previous, explicit and both implicit source identities in stable order", async () => {
    const catalog = fixture()
    catalog.listCatalogProductMediaItems.mockResolvedValue([
      catalogProductMediaItemFixture({ media_asset_id: "cmedia_previous" }),
    ])
    catalog.listCatalogMediaAssets
      .mockResolvedValueOnce([catalogMediaAssetFixture({ id: "cmedia_file" })])
      .mockResolvedValueOnce([catalogMediaAssetFixture({ id: "cmedia_url" })])
    expect(
      await resolveCatalogProductMediaLockKeys(catalog as never, {
        aggregateId: "prod_1",
        media: [
          { mediaAssetId: " cmedia_explicit " },
          {
            sourceFileKey: "owned-key",
            sourceUrl: "https://media.example/ignored",
          },
          { sourceUrl: "https://media.example/url" },
        ],
      })
    ).toEqual([
      "catalog:product-media:prod_1",
      "catalog:media-asset:cmedia_explicit",
      "catalog:media-asset:cmedia_file",
      "catalog:media-asset:cmedia_previous",
      "catalog:media-asset:cmedia_url",
    ])
    expect(catalog.listCatalogMediaAssets).toHaveBeenNthCalledWith(
      1,
      { lifecycle_status: "active", source_file_key: "owned-key" },
      { take: 2 },
      undefined
    )
    expect(catalog.listCatalogMediaAssets).toHaveBeenNthCalledWith(
      2,
      { lifecycle_status: "active", source_url: "https://media.example/url" },
      { take: 2 },
      undefined
    )
  })

  it("keeps explicit identity authoritative without an implicit lookup", async () => {
    const catalog = fixture()
    expect(
      await resolveCatalogProductMediaLockKeys(catalog as never, {
        aggregateId: "prod_1",
        media: [
          {
            mediaAssetId: "cmedia_explicit",
            sourceUrl: "https://media.example/url",
          },
          { mediaAssetId: "cmedia_explicit" },
        ],
      })
    ).toHaveLength(2)
    expect(catalog.listCatalogMediaAssets).not.toHaveBeenCalled()
  })

  it("does not fall back to a URL when the provided file key has no match", async () => {
    const catalog = fixture()
    await expect(
      findReusableCatalogMediaAsset(catalog as never, {
        sourceFileKey: " missing ",
        sourceUrl: "https://media.example/url",
      })
    ).resolves.toBeNull()
    expect(catalog.listCatalogMediaAssets).toHaveBeenCalledTimes(1)
    expect(catalog.listCatalogMediaAssets).toHaveBeenCalledWith(
      { lifecycle_status: "active", source_file_key: "missing" },
      { take: 2 },
      undefined
    )
  })

  it("does not invent a shared asset when neither source nor ID exists", async () => {
    const catalog = fixture()
    expect(
      await resolveCatalogProductMediaLockKeys(catalog as never, {
        aggregateId: "prod_1",
        media: [{}],
      })
    ).toEqual(["catalog:product-media:prod_1"])
    expect(catalog.listCatalogMediaAssets).not.toHaveBeenCalled()
  })

  it("rejects ambiguous implicit matches with the existing exact lookup bound", async () => {
    const catalog = fixture()
    catalog.listCatalogMediaAssets.mockResolvedValue([
      catalogMediaAssetFixture({ id: "cmedia_a" }),
      catalogMediaAssetFixture({ id: "cmedia_b" }),
    ])
    await expect(
      resolveCatalogProductMediaLockKeys(catalog as never, {
        aggregateId: "prod_1",
        media: [{ sourceUrl: "https://media.example/url" }],
      })
    ).rejects.toThrow()
  })

  it("allows the complete finite union of100 previous and100 different desired assets", async () => {
    const catalog = fixture()
    catalog.listCatalogProductMediaItems.mockResolvedValue(
      Array.from({ length: 100 }, (_, index) =>
        catalogProductMediaItemFixture({
          id: `cpmedia_${index}`,
          media_asset_id: `cmedia_old_${index}`,
        })
      )
    )
    const keys = await resolveCatalogProductMediaLockKeys(catalog as never, {
      aggregateId: "prod_1",
      media: Array.from({ length: 100 }, (_, index) => ({
        mediaAssetId: `cmedia_new_${index}`,
      })),
    })
    expect(keys).toHaveLength(201)
    expect(new Set(keys).size).toBe(201)
  })

  it("rejects an oversized desired gallery before any provider lookup", async () => {
    const catalog = fixture()
    await expect(
      resolveCatalogProductMediaLockKeys(catalog as never, {
        aggregateId: "prod_1",
        media: Array.from({ length: 101 }, () => ({})),
      })
    ).rejects.toMatchObject({ type: MedusaError.Types.INVALID_DATA })
    expect(catalog.listCatalogMediaAssets).not.toHaveBeenCalled()
    expect(catalog.listCatalogProductMediaItems).not.toHaveBeenCalled()
  })

  it("rejects drift to a previously unleased identity without rejecting complete inherited coverage", () => {
    expect(() =>
      assertCatalogMediaLockCoverage(
        ["catalog:product-media:prod_1", "catalog:media-asset:cmedia_a"],
        ["catalog:product-media:prod_1"]
      )
    ).toThrow(expect.objectContaining({ type: MedusaError.Types.CONFLICT }))
    expect(() =>
      assertCatalogMediaLockCoverage(
        ["catalog:media-asset:cmedia_a"],
        ["catalog:product-media:prod_1", "catalog:media-asset:cmedia_a"]
      )
    ).not.toThrow()
  })

  it("permits own transaction-created clone identities but rejects external unleased reuse", () => {
    const created = new Set(["cmedia_created"])
    expect(() =>
      assertCatalogMediaAssetLock("cmedia_created", [], created)
    ).not.toThrow()
    expect(() =>
      assertCatalogMediaAssetLock("cmedia_external", [], created)
    ).toThrow()
    expect(() =>
      assertCatalogMediaAssetLock("cmedia_external", [
        "catalog:media-asset:cmedia_external",
      ])
    ).not.toThrow()
    expect(() =>
      assertCatalogMediaAssetLock("cmedia_external", undefined)
    ).not.toThrow()
  })
})
