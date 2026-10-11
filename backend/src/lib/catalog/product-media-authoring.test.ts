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
import {
  catalogMediaAssetFixture,
  catalogOperationFixture,
  catalogProductMediaItemFixture,
  catalogProductProfileFixture,
} from "./transaction-persistence-fixtures.test-helpers"

const assetFixture = (
  id = "cmedia_1",
  sourceUrl = "https://media.example/cover.jpg"
): CatalogMediaAssetRecord => ({
  ...catalogMediaAssetFixture({ id, source_url: sourceUrl }),
})

const itemFixture = (
  id = "cpmedia_1",
  mediaAssetId = "cmedia_1"
): CatalogProductMediaItemRecord => ({
  ...catalogProductMediaItemFixture({ id, media_asset_id: mediaAssetId }),
})

const serviceFixture = () => {
  let persistedItems: CatalogProductMediaItemRecord[] = []
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
      callback({ transactionManager: { flush: jest.fn() } })
  )
  service.listCatalogAuthoringOperations.mockResolvedValue([])
  service.listCatalogMediaAssets.mockResolvedValue([])
  service.listCatalogProductMediaItems.mockImplementation(
    async (filters: Record<string, unknown>) =>
      filters.media_asset_id
        ? persistedItems.filter(
            ({ media_asset_id }) => media_asset_id === filters.media_asset_id
          )
        : persistedItems
  )
  service.listCatalogProductProfiles.mockResolvedValue([
    catalogProductProfileFixture(),
  ])
  service.createCatalogAuthoringOperations.mockImplementation(
    async ([payload]: Array<Record<string, unknown>>) => [
      catalogOperationFixture({ id: "catop_1", ...payload }),
    ]
  )
  service.createCatalogProductMediaItems.mockImplementation(
    async (payloads: Array<Record<string, unknown>>) => {
      persistedItems = payloads.map((payload, index) =>
        catalogProductMediaItemFixture({
          ...payload,
          id: `cpmedia_${index + 1}`,
        })
      )
      return persistedItems
    }
  )
  service.deleteCatalogProductMediaItems.mockImplementation(async () => {
    persistedItems = []
  })
  return service
}

const commandFixture = (
  media: CatalogProductMediaMutationInput["media"] = []
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
      catalogProductMediaReplaceSchema.safeParse({ media: [] }).success
    ).toBe(false)
    expect(
      catalogProductMediaReplaceSchema.safeParse({
        expectedVersion: 0,
        idempotencyKey: commandFixture().idempotencyKey,
        media: [{ sourceUrl: "javascript:alert(1)" }],
      }).success
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
      }).success
    ).toBe(false)
  })

  it("rejects duplicate primary media within the same scope", () => {
    expect(() =>
      assertCatalogProductMediaPrimaryShape([
        { isPrimary: true, sourceUrl: "https://media.example/one.jpg" },
        { role: "primary", sourceUrl: "https://media.example/two.jpg" },
      ])
    ).toThrow("Only one primary")
  })

  it("creates a pending operation and owns newly created assets", async () => {
    const service = serviceFixture()
    const createdAsset = assetFixture()
    service.createCatalogMediaAssets.mockImplementation(
      async ([payload]: Array<Record<string, unknown>>) => [
        { ...createdAsset, ...payload },
      ]
    )

    const result = await mutateCatalogProductMedia(
      service as never,
      commandFixture([
        {
          altText: "Cover",
          sourceUrl: createdAsset.source_url,
        },
      ])
    )

    expect(result).toEqual(
      expect.objectContaining({
        createdAssetIds: ["cmedia_1"],
        operationId: "catop_1",
        productId: "prod_1",
        replayed: false,
        version: 1,
      })
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
      expect.any(Object)
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
      expect.any(Object)
    )
    expect(service.updateCatalogAuthoringOperations).not.toHaveBeenCalled()
  })

  it("clones reusable assets instead of mutating another product's metadata", async () => {
    const service = serviceFixture()
    const reusable = assetFixture("cmedia_shared")
    const clone = {
      ...assetFixture("cmedia_clone"),
      alt_text: "Product-specific cover text",
      version: 1,
    }
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
      ])
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
      expect.any(Object)
    )
    expect(result.createdAssetIds).toEqual(["cmedia_clone"])
  })

  it("rejects an externally appearing implicit source inside the transaction before cloning or relinking", async () => {
    const service = serviceFixture()
    const source = assetFixture("cmedia_external")
    service.listCatalogMediaAssets.mockResolvedValue([source])
    await expect(
      mutateCatalogProductMedia(
        service as never,
        commandFixture([{ sourceUrl: source.source_url }]),
        { lockKeys: ["catalog:product-media:prod_1"] }
      )
    ).rejects.toThrow("changed while acquiring")
    expect(service.createCatalogMediaAssets).not.toHaveBeenCalled()
    expect(service.updateCatalogMediaAssets).not.toHaveBeenCalled()
    expect(service.deleteCatalogProductMediaItems).not.toHaveBeenCalled()
    expect(service.createCatalogProductMediaItems).not.toHaveBeenCalled()
  })

  it("allows a second implicit item to clone a source created by this same transaction", async () => {
    const service = serviceFixture()
    const created: CatalogMediaAssetRecord[] = []
    service.listCatalogMediaAssets.mockImplementation(async () => created)
    service.createCatalogMediaAssets.mockImplementation(async ([payload]) => {
      const row = {
        ...assetFixture(`cmedia_created_${created.length}`),
        ...payload,
      }
      created.push(row)
      return [row]
    })
    const result = await mutateCatalogProductMedia(
      service as never,
      commandFixture([
        {
          sourceUrl: "https://media.example/own-transaction.webp",
          altText: "First",
        },
        {
          sourceUrl: "https://media.example/own-transaction.webp",
          altText: "Second",
        },
      ]),
      { lockKeys: ["catalog:product-media:prod_1"] }
    )
    expect(result.createdAssetIds).toEqual([
      "cmedia_created_0",
      "cmedia_created_1",
    ])
    expect(created.map(({ alt_text }) => alt_text)).toEqual(["First", "Second"])
    expect(service.updateCatalogMediaAssets).not.toHaveBeenCalled()
  })

  it("never links, edits, or reuses quarantined media", async () => {
    const service = serviceFixture()
    service.retrieveCatalogMediaAsset.mockResolvedValue({
      ...assetFixture("cmedia_quarantined"),
      lifecycle_status: "quarantined",
      purge_eligible_at: "2026-09-29T00:00:00.000Z",
      quarantined_at: "2026-08-30T00:00:00.000Z",
      quarantined_by: "user_1",
    })

    await expect(
      mutateCatalogProductMedia(
        service as never,
        commandFixture([
          {
            mediaAssetId: "cmedia_quarantined",
          },
        ])
      )
    ).rejects.toThrow("Quarantined catalog media")
    expect(service.createCatalogProductMediaItems).not.toHaveBeenCalled()

    service.retrieveCatalogMediaAsset.mockReset()
    service.listCatalogMediaAssets.mockResolvedValue([])
    service.createCatalogMediaAssets.mockImplementation(
      async ([payload]: Array<Record<string, unknown>>) => [
        { ...assetFixture("cmedia_active"), ...payload },
      ]
    )
    await mutateCatalogProductMedia(
      service as never,
      commandFixture([
        {
          sourceFileKey: "file_quarantined",
          sourceUrl: "https://media.example/quarantined.jpg",
        },
      ])
    )
    expect(service.listCatalogMediaAssets).toHaveBeenCalledWith(
      {
        lifecycle_status: "active",
        source_file_key: "file_quarantined",
      },
      { take: 2 },
      expect.any(Object)
    )
  })

  it.each([
    { sourceUrl: "https://media.example/replaced.jpg" },
    { sourceFileKey: "covers/replaced.jpg" },
  ])(
    "rejects changing the source of an existing shared asset: %j",
    async (patch) => {
      const service = serviceFixture()
      service.retrieveCatalogMediaAsset.mockResolvedValue(assetFixture())
      await expect(
        mutateCatalogProductMedia(
          service as never,
          commandFixture([{ mediaAssetId: "cmedia_1", ...patch }])
        )
      ).rejects.toThrow("source URLs and file keys are read-only")
      expect(service.updateCatalogMediaAssets).not.toHaveBeenCalled()
      expect(service.deleteCatalogProductMediaItems).not.toHaveBeenCalled()
      expect(service.createCatalogProductMediaItems).not.toHaveBeenCalled()
    }
  )

  it("accepts unchanged source diagnostics for an existing asset", async () => {
    const service = serviceFixture()
    const asset = assetFixture()
    service.retrieveCatalogMediaAsset.mockResolvedValue(asset)
    await expect(
      mutateCatalogProductMedia(
        service as never,
        commandFixture([
          {
            mediaAssetId: asset.id,
            sourceUrl: asset.source_url,
            sourceFileKey: asset.source_file_key,
          },
        ])
      )
    ).resolves.toMatchObject({ createdAssetIds: [], replayed: false })
    expect(service.updateCatalogMediaAssets).not.toHaveBeenCalled()
  })

  it("rejects a stale aggregate version before creating an operation", async () => {
    const service = serviceFixture()
    service.listCatalogAuthoringOperations.mockImplementation(
      async (filters: Record<string, unknown>) =>
        filters.idempotency_key
          ? []
          : [
              catalogOperationFixture({
                expected_version: 1,
                result: { productId: "prod_1", version: 2 },
                status: "succeeded",
              }),
            ]
    )

    await expect(
      mutateCatalogProductMedia(service as never, commandFixture())
    ).rejects.toThrow("changed after it was loaded")
    expect(service.createCatalogAuthoringOperations).not.toHaveBeenCalled()
  })

  it("replays only the exact succeeded command", async () => {
    const service = serviceFixture()
    const command = commandFixture()
    service.listCatalogAuthoringOperations.mockResolvedValue([
      catalogOperationFixture({
        actor_id: command.actorId,
        aggregate_id: command.aggregateId,
        command: command.command,
        expected_version: command.expectedVersion,
        id: "catop_1",
        request_sha256: command.requestSha256,
        result: { productId: "prod_1", version: 1 },
        status: "succeeded",
      }),
    ])

    await expect(
      mutateCatalogProductMedia(service as never, command)
    ).resolves.toEqual(
      expect.objectContaining({
        operationId: "catop_1",
        replayed: true,
        version: 1,
      })
    )
    await expect(
      mutateCatalogProductMedia(service as never, {
        ...command,
        requestSha256: "b".repeat(64),
      })
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
    service.listCatalogProductMediaItems
      .mockResolvedValueOnce([itemFixture("cpmedia_new", "cmedia_new")])
      .mockResolvedValueOnce([previousItem])
      .mockResolvedValueOnce([])
    service.listCatalogMediaAssets.mockResolvedValue([
      { ...previousAsset, alt_text: "Changed", version: 2 },
    ])
    service.listCatalogAuthoringOperations.mockResolvedValue([
      catalogOperationFixture({ id: "catop_1" }),
    ])
    service.updateCatalogMediaAssets.mockImplementation(
      async ([payload]: Array<Record<string, unknown>>) => [
        catalogMediaAssetFixture(payload),
      ]
    )
    service.createCatalogProductMediaItems.mockResolvedValue([previousItem])
    service.updateCatalogAuthoringOperations.mockResolvedValue([
      catalogOperationFixture({
        id: "catop_1",
        status: "compensated",
      }),
    ])

    await compensateCatalogProductMediaMutation(service as never, {
      aggregateId: "prod_1",
      createdAssetIds: ["cmedia_new"],
      operationId: "catop_1",
      previous,
    })

    expect(service.deleteCatalogProductMediaItems).toHaveBeenCalledWith(
      ["cpmedia_new"],
      expect.any(Object)
    )
    expect(service.updateCatalogMediaAssets).toHaveBeenCalledWith(
      previous.assets,
      expect.any(Object)
    )
    expect(service.createCatalogProductMediaItems).toHaveBeenCalledWith(
      previous.items,
      expect.any(Object)
    )
    expect(service.deleteCatalogMediaAssets).toHaveBeenCalledWith(
      "cmedia_new",
      expect.any(Object)
    )
    expect(service.updateCatalogAuthoringOperations).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          error_code: "workflow_compensated",
          id: "catop_1",
          status: "compensated",
        }),
      ],
      expect.any(Object)
    )
  })
})

describe("catalog media pending-audit conflict recovery", () => {
  it.each(["40001", "40P01"])(
    "rolls back an early %s audit conflict before a fresh complete attempt",
    async (code) => {
      const service = serviceFixture()
      const conflict = Object.assign(new Error("Owned SQL conflict"), { code })
      const contexts: Array<{ transactionManager: { flush: jest.Mock } }> = []
      const events: string[] = []
      let rows: ReturnType<typeof catalogOperationFixture>[] = []
      service.createCatalogAuthoringOperations.mockImplementation(
        async ([payload]: Array<Record<string, unknown>>) => {
          const row = catalogOperationFixture({
            ...payload,
            id: `catop_attempt_${contexts.length}`,
          })
          rows.push(row)
          return [row]
        }
      )
      service.runCatalogTransaction.mockImplementation(
        async (
          task: (context: Record<string, unknown>) => Promise<unknown>
        ) => {
          const attempt = contexts.length + 1
          const previousRows = [...rows]
          const context = {
            transactionManager: {
              flush: jest.fn(async () => {
                if (attempt === 1) throw conflict
              }),
            },
          }
          contexts.push(context)
          events.push(`begin:${attempt}`)
          try {
            const result = await task(context)
            events.push(`commit:${attempt}`)
            return result
          } catch (error) {
            rows = previousRows
            events.push(`rollback:${attempt}`)
            throw error
          }
        }
      )

      const result = await mutateCatalogProductMedia(
        service as never,
        commandFixture()
      )
      expect(events).toEqual(["begin:1", "rollback:1", "begin:2", "commit:2"])
      expect(contexts).toHaveLength(2)
      expect(contexts[0]).not.toBe(contexts[1])
      expect(contexts[0]!.transactionManager).not.toBe(
        contexts[1]!.transactionManager
      )
      expect(contexts[0]!.transactionManager.flush).toHaveBeenCalledTimes(1)
      expect(contexts[1]!.transactionManager.flush).toHaveBeenCalledTimes(1)
      expect(
        service.createCatalogAuthoringOperations.mock.calls[0]![0]
      ).toEqual(service.createCatalogAuthoringOperations.mock.calls[1]![0])
      expect(rows.map(({ id }) => id)).toEqual(["catop_attempt_2"])
      expect(result).toMatchObject({
        operationId: "catop_attempt_2",
        version: 1,
        replayed: false,
      })
      expect(service.updateCatalogMediaAssets).not.toHaveBeenCalled()
      expect(service.createCatalogProductMediaItems).not.toHaveBeenCalled()
    }
  )

  it("stops after three rolled-back preflight conflicts and preserves the error", async () => {
    const service = serviceFixture()
    const conflict = Object.assign(new Error("Owned SQL conflict"), {
      code: "40001",
    })
    const contexts: Record<string, unknown>[] = []
    service.runCatalogTransaction.mockImplementation(
      async (task: (context: Record<string, unknown>) => Promise<unknown>) => {
        const context = {
          transactionManager: {
            flush: jest.fn(async () => {
              throw conflict
            }),
          },
        }
        contexts.push(context)
        return task(context)
      }
    )
    await expect(
      mutateCatalogProductMedia(service as never, commandFixture())
    ).rejects.toBe(conflict)
    expect(contexts).toHaveLength(3)
    expect(new Set(contexts).size).toBe(3)
    expect(service.createCatalogAuthoringOperations).toHaveBeenCalledTimes(3)
    expect(service.updateCatalogMediaAssets).not.toHaveBeenCalled()
    expect(service.createCatalogProductMediaItems).not.toHaveBeenCalled()
  })

  it("rechecks authoritative version after an early conflict without changing the command", async () => {
    const service = serviceFixture()
    const conflict = Object.assign(new Error("Owned SQL conflict"), {
      code: "40001",
    })
    let attempt = 0
    service.runCatalogTransaction.mockImplementation(
      async (task: (context: Record<string, unknown>) => Promise<unknown>) => {
        attempt += 1
        return task({
          transactionManager: {
            flush: jest.fn(async () => {
              if (attempt === 1) throw conflict
            }),
          },
        })
      }
    )
    service.listCatalogAuthoringOperations.mockImplementation(
      async (filters: Record<string, unknown>) =>
        attempt === 2 && filters.status === "succeeded"
          ? [
              catalogOperationFixture({
                expected_version: 0,
                result: { productId: "prod_1", version: 1 },
                status: "succeeded",
              }),
            ]
          : []
    )
    const input = commandFixture()
    await expect(
      mutateCatalogProductMedia(service as never, input)
    ).rejects.toThrow("changed after it was loaded")
    expect(attempt).toBe(2)
    expect(input.expectedVersion).toBe(0)
    expect(service.createCatalogAuthoringOperations).toHaveBeenCalledTimes(1)
    expect(service.createCatalogProductMediaItems).not.toHaveBeenCalled()
  })

  it("never retries an asset write failure after the pending audit flush", async () => {
    const service = serviceFixture()
    const asset = assetFixture()
    service.retrieveCatalogMediaAsset.mockResolvedValue(asset)
    const conflict = Object.assign(new Error("Owned late SQL conflict"), {
      code: "40001",
    })
    service.updateCatalogMediaAssets.mockRejectedValue(conflict)
    await expect(
      mutateCatalogProductMedia(
        service as never,
        commandFixture([
          { mediaAssetId: asset.id, altText: "Later owned edit" },
        ])
      )
    ).rejects.toBe(conflict)
    expect(service.runCatalogTransaction).toHaveBeenCalledTimes(1)
    expect(service.updateCatalogMediaAssets).toHaveBeenCalledTimes(1)
    expect(service.createCatalogAuthoringOperations).toHaveBeenCalledTimes(1)
    expect(service.createCatalogProductMediaItems).not.toHaveBeenCalled()
  })

  it("never retries a commit-stage conflict after the transaction task returned", async () => {
    const service = serviceFixture()
    const conflict = Object.assign(new Error("Owned commit conflict"), {
      code: "40001",
    })
    service.runCatalogTransaction.mockImplementation(
      async (task: (context: Record<string, unknown>) => Promise<unknown>) => {
        await task({ transactionManager: { flush: jest.fn() } })
        throw conflict
      }
    )
    await expect(
      mutateCatalogProductMedia(service as never, commandFixture())
    ).rejects.toBe(conflict)
    expect(service.runCatalogTransaction).toHaveBeenCalledTimes(1)
    expect(service.createCatalogAuthoringOperations).toHaveBeenCalledTimes(1)
  })

  it("never retries a replay commit error after the read-only task returned", async () => {
    const service = serviceFixture()
    const input = commandFixture()
    service.listCatalogAuthoringOperations.mockResolvedValue([
      catalogOperationFixture({
        actor_id: input.actorId,
        aggregate_id: input.aggregateId,
        command: input.command,
        expected_version: input.expectedVersion,
        id: "catop_replayed",
        request_sha256: input.requestSha256,
        result: { productId: "prod_1", version: 1 },
        status: "succeeded",
      }),
    ])
    const conflict = Object.assign(new Error("Owned replay commit conflict"), {
      code: "40001",
    })
    service.runCatalogTransaction.mockImplementation(
      async (task: (context: Record<string, unknown>) => Promise<unknown>) => {
        await task({ transactionManager: { flush: jest.fn() } })
        throw conflict
      }
    )
    await expect(
      mutateCatalogProductMedia(service as never, input)
    ).rejects.toBe(conflict)
    expect(service.runCatalogTransaction).toHaveBeenCalledTimes(1)
    expect(service.createCatalogAuthoringOperations).not.toHaveBeenCalled()
  })

  it.each(["23505", "08006", undefined])(
    "does not retry an early failure with SQLSTATE %s",
    async (code) => {
      const service = serviceFixture()
      const failure = Object.assign(
        new Error(
          "could not serialize; DeadlockException name is insufficient"
        ),
        { code, name: "DeadlockException" }
      )
      service.runCatalogTransaction.mockImplementation(
        async (task: (context: Record<string, unknown>) => Promise<unknown>) =>
          task({
            transactionManager: {
              flush: jest.fn(async () => {
                throw failure
              }),
            },
          })
      )
      await expect(
        mutateCatalogProductMedia(service as never, commandFixture())
      ).rejects.toBe(failure)
      expect(service.runCatalogTransaction).toHaveBeenCalledTimes(1)
      expect(service.createCatalogAuthoringOperations).toHaveBeenCalledTimes(1)
    }
  )
})
