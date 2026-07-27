import type {
  CatalogMediaAssetRecord,
  CatalogProductMediaItemRecord,
} from "../../modules/catalog/serializers"
import {
  assertCatalogProductMediaPrimaryShape,
  catalogProductMediaReplaceSchema,
  compensateCatalogProductMediaMutation,
  mutateCatalogProductMedia,
  type CatalogProductMediaMutationInput,
  type CatalogProductMediaSnapshot,
} from "./product-media-authoring"

const assetFixture = (
  id = "cmedia_1",
  sourceUrl = "https://media.example/cover.jpg",
): CatalogMediaAssetRecord => ({
  alt_text: "Cover",
  byte_size: 1_024,
  caption: null,
  content_sha256: null,
  created_at: null,
  crop_intent: null,
  derivative_status: "source_only",
  derivatives: {},
  focal_x: 0.5,
  focal_y: 0.5,
  height: 1_000,
  id,
  metadata: {},
  mime_type: "image/jpeg",
  original_filename: "cover.jpg",
  source_file_key: "covers/cover.jpg",
  source_url: sourceUrl,
  updated_at: null,
  version: 1,
  width: 1_000,
})

const itemFixture = (
  id = "cpmedia_1",
  mediaAssetId = "cmedia_1",
): CatalogProductMediaItemRecord => ({
  created_at: null,
  id,
  is_primary: true,
  media_asset_id: mediaAssetId,
  metadata: {},
  product_id: "prod_1",
  product_profile_id: "cprof_1",
  role: "primary",
  sort_order: 0,
  updated_at: null,
  variant_id: null,
})

const serviceFixture = () => {
  const service = {
    createCatalogAuthoringOperations: jest.fn(),
    createCatalogMediaAssets: jest.fn(),
    createCatalogProductMediaItems: jest.fn(),
    deleteCatalogMediaAssets: jest.fn(),
    deleteCatalogProductMediaItems: jest.fn(),
    listCatalogAuthoringOperations: jest.fn(),
    listCatalogMediaAssets: jest.fn(),
    listCatalogProductMediaItems: jest.fn(),
    listCatalogProductProfiles: jest.fn(),
    retrieveCatalogMediaAsset: jest.fn(),
    retrieveCatalogProductProfile: jest.fn(),
    runCatalogTransaction: jest.fn(),
    updateCatalogAuthoringOperations: jest.fn(),
    updateCatalogMediaAssets: jest.fn(),
  }
  service.runCatalogTransaction.mockImplementation(
    async (callback: (context: Record<string, unknown>) => unknown) =>
      callback({ transactionManager: {} }),
  )
  service.listCatalogAuthoringOperations.mockResolvedValue([])
  service.listCatalogMediaAssets.mockResolvedValue([])
  service.listCatalogProductMediaItems.mockResolvedValue([])
  service.listCatalogProductProfiles.mockResolvedValue([{ id: "cprof_1" }])
  return service
}

const commandFixture = (
  media: CatalogProductMediaMutationInput["media"] = [],
): CatalogProductMediaMutationInput => ({
  actorId: "user_1",
  aggregateId: "prod_1",
  command: "catalog.product-media.replace",
  expectedVersion: 0,
  idempotencyKey: "00000000-0000-4000-8000-000000000001",
  media,
  requestSha256: "a".repeat(64),
})

describe("catalog product media authoring", () => {
  it("requires command metadata and rejects unsafe or oversized fields", () => {
    expect(
      catalogProductMediaReplaceSchema.safeParse({ media: [] }).success,
    ).toBe(false)
    expect(
      catalogProductMediaReplaceSchema.safeParse({
        expectedVersion: 0,
        idempotencyKey: commandFixture().idempotencyKey,
        media: [{ sourceUrl: "javascript:alert(1)" }],
      }).success,
    ).toBe(false)
    expect(
      catalogProductMediaReplaceSchema.safeParse({
        expectedVersion: 0,
        idempotencyKey: commandFixture().idempotencyKey,
        media: [
          {
            sourceUrl: "https://media.example/cover.jpg",
            altText: "x".repeat(2_001),
          },
        ],
      }).success,
    ).toBe(false)
  })

  it("rejects duplicate primary media within the same scope", () => {
    expect(() =>
      assertCatalogProductMediaPrimaryShape([
        { isPrimary: true, sourceUrl: "https://media.example/one.jpg" },
        { role: "primary", sourceUrl: "https://media.example/two.jpg" },
      ]),
    ).toThrow("Only one primary")
  })

  it("creates a pending operation and owns newly created assets", async () => {
    const service = serviceFixture()
    const createdAsset = assetFixture()
    service.createCatalogAuthoringOperations.mockResolvedValue([
      { id: "caop_1" },
    ])
    service.createCatalogMediaAssets.mockResolvedValue([createdAsset])

    const result = await mutateCatalogProductMedia(
      service as never,
      commandFixture([
        {
          altText: "Cover",
          sourceUrl: createdAsset.source_url,
        },
      ]),
    )

    expect(result).toEqual(
      expect.objectContaining({
        createdAssetIds: ["cmedia_1"],
        operationId: "caop_1",
        productId: "prod_1",
        replayed: false,
        version: 1,
      }),
    )
    expect(service.createCatalogAuthoringOperations).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          aggregate_id: "prod_1",
          command: "catalog.product-media.replace",
          expected_version: 0,
          status: "pending",
        }),
      ],
      expect.any(Object),
    )
    expect(service.createCatalogProductMediaItems).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          is_primary: true,
          media_asset_id: "cmedia_1",
          product_id: "prod_1",
          product_profile_id: "cprof_1",
          role: "primary",
        }),
      ],
      expect.any(Object),
    )
    expect(service.updateCatalogAuthoringOperations).not.toHaveBeenCalled()
  })

  it("clones reusable assets instead of mutating another product's metadata", async () => {
    const service = serviceFixture()
    const reusable = assetFixture("cmedia_shared")
    const clone = assetFixture("cmedia_clone")
    service.createCatalogAuthoringOperations.mockResolvedValue([
      { id: "caop_1" },
    ])
    service.listCatalogMediaAssets.mockResolvedValue([reusable])
    service.createCatalogMediaAssets.mockResolvedValue([clone])

    const result = await mutateCatalogProductMedia(
      service as never,
      commandFixture([
        {
          altText: "Product-specific cover text",
          sourceFileKey: reusable.source_file_key,
          sourceUrl: reusable.source_url,
        },
      ]),
    )

    expect(service.updateCatalogMediaAssets).not.toHaveBeenCalled()
    expect(service.createCatalogMediaAssets).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          alt_text: "Product-specific cover text",
          source_file_key: reusable.source_file_key,
          source_url: reusable.source_url,
          version: 1,
        }),
      ],
      expect.any(Object),
    )
    expect(result.createdAssetIds).toEqual(["cmedia_clone"])
  })

  it("never links, edits, or reuses quarantined media", async () => {
    const service = serviceFixture()
    service.createCatalogAuthoringOperations.mockResolvedValue([
      { id: "caop_1" },
    ])
    service.retrieveCatalogMediaAsset.mockResolvedValue({
      ...assetFixture("cmedia_quarantined"),
      lifecycle_status: "quarantined",
    })

    await expect(
      mutateCatalogProductMedia(
        service as never,
        commandFixture([
          {
            mediaAssetId: "cmedia_quarantined",
          },
        ]),
      ),
    ).rejects.toThrow("Quarantined catalog media")
    expect(service.createCatalogProductMediaItems).not.toHaveBeenCalled()

    service.retrieveCatalogMediaAsset.mockReset()
    service.listCatalogMediaAssets.mockResolvedValue([])
    service.createCatalogMediaAssets.mockResolvedValue([
      assetFixture("cmedia_active"),
    ])
    await mutateCatalogProductMedia(
      service as never,
      commandFixture([
        {
          sourceFileKey: "file_quarantined",
          sourceUrl: "https://media.example/quarantined.jpg",
        },
      ]),
    )
    expect(service.listCatalogMediaAssets).toHaveBeenCalledWith(
      {
        lifecycle_status: "active",
        source_file_key: "file_quarantined",
      },
      { take: 1 },
      expect.any(Object),
    )
  })

  it("rejects a stale aggregate version before creating an operation", async () => {
    const service = serviceFixture()
    service.listCatalogAuthoringOperations.mockImplementation(
      async (filters: Record<string, unknown>) =>
        filters.idempotency_key
          ? []
          : [{ expected_version: 1, result: { version: 2 } }],
    )

    await expect(
      mutateCatalogProductMedia(service as never, commandFixture()),
    ).rejects.toThrow("changed after it was loaded")
    expect(service.createCatalogAuthoringOperations).not.toHaveBeenCalled()
  })

  it("replays only the exact succeeded command", async () => {
    const service = serviceFixture()
    const command = commandFixture()
    service.listCatalogAuthoringOperations.mockResolvedValue([
      {
        actor_id: command.actorId,
        aggregate_id: command.aggregateId,
        command: command.command,
        expected_version: command.expectedVersion,
        id: "caop_1",
        request_sha256: command.requestSha256,
        result: { productId: "prod_1", version: 1 },
        status: "succeeded",
      },
    ])

    await expect(
      mutateCatalogProductMedia(service as never, command),
    ).resolves.toEqual(
      expect.objectContaining({
        operationId: "caop_1",
        replayed: true,
        version: 1,
      }),
    )
    await expect(
      mutateCatalogProductMedia(service as never, {
        ...command,
        requestSha256: "b".repeat(64),
      }),
    ).rejects.toThrow("cannot be replayed")
  })

  it("restores links and asset metadata before removing owned orphans", async () => {
    const service = serviceFixture()
    const previousAsset = assetFixture()
    const previousItem = itemFixture()
    const previous: CatalogProductMediaSnapshot = {
      assets: [
        {
          alt_text: previousAsset.alt_text,
          byte_size: previousAsset.byte_size,
          caption: previousAsset.caption,
          content_sha256: previousAsset.content_sha256,
          crop_intent: previousAsset.crop_intent,
          derivative_status: "source_only",
          derivatives: {},
          focal_x: previousAsset.focal_x,
          focal_y: previousAsset.focal_y,
          height: previousAsset.height,
          id: previousAsset.id,
          metadata: {},
          mime_type: previousAsset.mime_type,
          original_filename: previousAsset.original_filename,
          source_file_key: previousAsset.source_file_key,
          source_url: previousAsset.source_url,
          version: previousAsset.version,
          width: previousAsset.width,
        },
      ],
      items: [
        {
          id: previousItem.id,
          is_primary: previousItem.is_primary,
          media_asset_id: previousItem.media_asset_id,
          metadata: {},
          product_id: previousItem.product_id,
          product_profile_id: previousItem.product_profile_id,
          role: "primary",
          sort_order: previousItem.sort_order,
          variant_id: previousItem.variant_id,
        },
      ],
    }
    service.listCatalogProductMediaItems.mockImplementation(
      async (filters: Record<string, unknown>) =>
        filters.media_asset_id ? [] : [itemFixture("cpmedia_new", "cmedia_new")],
    )
    service.listCatalogMediaAssets.mockResolvedValue([
      { ...previousAsset, alt_text: "Changed", version: 2 },
    ])

    await compensateCatalogProductMediaMutation(service as never, {
      aggregateId: "prod_1",
      createdAssetIds: ["cmedia_new"],
      operationId: "caop_1",
      previous,
    })

    expect(service.deleteCatalogProductMediaItems).toHaveBeenCalledWith(
      ["cpmedia_new"],
      expect.any(Object),
    )
    expect(service.updateCatalogMediaAssets).toHaveBeenCalledWith(
      previous.assets,
      expect.any(Object),
    )
    expect(service.createCatalogProductMediaItems).toHaveBeenCalledWith(
      previous.items,
      expect.any(Object),
    )
    expect(service.deleteCatalogMediaAssets).toHaveBeenCalledWith(
      "cmedia_new",
      expect.any(Object),
    )
    expect(service.updateCatalogAuthoringOperations).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          error_code: "workflow_compensated",
          id: "caop_1",
          status: "compensated",
        }),
      ],
      expect.any(Object),
    )
  })
})
