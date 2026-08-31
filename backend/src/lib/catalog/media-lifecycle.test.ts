import {
  catalogMediaLifecycleCommandSchema,
  compensateCatalogMediaLifecycle,
  mutateCatalogMediaLifecycle,
  type CatalogMediaLifecycleInput,
} from "./media-lifecycle"
import {
  catalogMediaAssetFixture,
  catalogOperationFixture,
  catalogProductMediaItemFixture,
} from "./transaction-persistence-fixtures.test-helpers"

const activeAsset = catalogMediaAssetFixture()

const serviceFixture = () => {
  const service = {
    completeCatalogAuthoringOperation: jest.fn(),
    createCatalogAuthoringOperations: jest.fn(),
    listCatalogAuthoringOperations: jest.fn(),
    listCatalogProductMediaItems: jest.fn(),
    retrieveCatalogMediaAsset: jest.fn(),
    runCatalogTransaction: jest.fn(),
    updateCatalogAuthoringOperations: jest.fn(),
    updateCatalogMediaAssets: jest.fn(),
  }
  service.runCatalogTransaction.mockImplementation(
    async (callback: (context: Record<string, unknown>) => unknown) =>
      callback({ transactionManager: {} })
  )
  service.listCatalogAuthoringOperations.mockResolvedValue([])
  service.listCatalogProductMediaItems.mockResolvedValue([])
  service.retrieveCatalogMediaAsset.mockResolvedValue(activeAsset)
  service.createCatalogAuthoringOperations.mockImplementation(
    async ([payload]: Array<Record<string, unknown>>) => [
      catalogOperationFixture({ id: "catop_1", ...payload }),
    ]
  )
  service.updateCatalogMediaAssets.mockImplementation(
    async ([payload]: Array<Record<string, unknown>>) => [
      catalogMediaAssetFixture(payload),
    ]
  )
  return service
}

const commandFixture = (
  command: CatalogMediaLifecycleInput["command"] = "catalog.media.quarantine"
): CatalogMediaLifecycleInput => ({
  actorId: "user_1",
  assetId: "cmedia_1",
  command,
  expectedVersion: 1,
  idempotencyKey: "00000000-0000-4000-8000-000000000001",
  requestSha256: "a".repeat(64),
})

describe("catalog media lifecycle", () => {
  it("requires a positive expected version and UUID idempotency key", () => {
    expect(
      catalogMediaLifecycleCommandSchema.safeParse({
        expectedVersion: 0,
        idempotencyKey: "not-a-uuid",
      }).success
    ).toBe(false)
  })

  it("quarantines only an unlinked active asset for thirty days", async () => {
    const service = serviceFixture()
    const now = new Date("2026-07-26T20:00:00.000Z")
    const input = commandFixture()

    await expect(
      mutateCatalogMediaLifecycle(service as never, input, now)
    ).resolves.toEqual({
      assetId: "cmedia_1",
      lifecycleStatus: "quarantined",
      operationId: "catop_1",
      previous: {
        lifecycle_status: "active",
        purge_eligible_at: null,
        quarantined_at: null,
        quarantined_by: null,
        version: 1,
      },
      purgeEligibleAt: "2026-08-25T20:00:00.000Z",
      quarantinedAt: "2026-07-26T20:00:00.000Z",
      replayed: false,
      version: 2,
    })
    expect(service.listCatalogProductMediaItems).toHaveBeenCalledWith(
      { media_asset_id: "cmedia_1" },
      { take: 2 },
      expect.any(Object)
    )
    expect(service.createCatalogAuthoringOperations).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          actor_id: "user_1",
          aggregate_id: "cmedia_1",
          command: "catalog.media.quarantine",
          expected_version: 1,
          metadata: { retention_days: 30 },
          status: "pending",
        }),
      ],
      expect.any(Object)
    )
    expect(service.updateCatalogMediaAssets).toHaveBeenCalledWith(
      [
        {
          id: "cmedia_1",
          lifecycle_status: "quarantined",
          purge_eligible_at: new Date("2026-08-25T20:00:00.000Z"),
          quarantined_at: now,
          quarantined_by: "user_1",
          version: 2,
        },
      ],
      expect.any(Object)
    )
  })

  it("rejects linked, stale, and already-quarantined assets", async () => {
    const linkedService = serviceFixture()
    linkedService.listCatalogProductMediaItems.mockResolvedValue([
      catalogProductMediaItemFixture(),
    ])
    await expect(
      mutateCatalogMediaLifecycle(linkedService as never, commandFixture())
    ).rejects.toThrow("Linked catalog media")
    expect(
      linkedService.createCatalogAuthoringOperations
    ).not.toHaveBeenCalled()

    const staleService = serviceFixture()
    await expect(
      mutateCatalogMediaLifecycle(staleService as never, {
        ...commandFixture(),
        expectedVersion: 2,
      })
    ).rejects.toThrow("changed after it was loaded")

    const quarantinedService = serviceFixture()
    quarantinedService.retrieveCatalogMediaAsset.mockResolvedValue({
      ...activeAsset,
      lifecycle_status: "quarantined",
      purge_eligible_at: "2026-08-25T20:00:00.000Z",
      quarantined_at: "2026-07-26T20:00:00.000Z",
      quarantined_by: "user_1",
    })
    await expect(
      mutateCatalogMediaLifecycle(quarantinedService as never, commandFixture())
    ).rejects.toThrow("already quarantined")
  })

  it("restores quarantine state without checking product links", async () => {
    const service = serviceFixture()
    const quarantinedAt = new Date("2026-07-01T00:00:00.000Z")
    const purgeEligibleAt = new Date("2026-07-31T00:00:00.000Z")
    service.retrieveCatalogMediaAsset.mockResolvedValue({
      ...activeAsset,
      lifecycle_status: "quarantined",
      purge_eligible_at: purgeEligibleAt,
      quarantined_at: quarantinedAt,
      quarantined_by: "user_1",
      version: 2,
    })

    await expect(
      mutateCatalogMediaLifecycle(
        service as never,
        {
          ...commandFixture("catalog.media.restore"),
          expectedVersion: 2,
        },
        new Date("2026-07-26T20:00:00.000Z")
      )
    ).resolves.toMatchObject({
      lifecycleStatus: "active",
      purgeEligibleAt: null,
      quarantinedAt: null,
      version: 3,
    })
    expect(service.listCatalogProductMediaItems).not.toHaveBeenCalled()
    expect(service.updateCatalogMediaAssets).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          lifecycle_status: "active",
          purge_eligible_at: null,
          quarantined_at: null,
          quarantined_by: null,
          version: 3,
        }),
      ],
      expect.any(Object)
    )
  })

  it("replays only the exact succeeded command and validates its result", async () => {
    const service = serviceFixture()
    const input = commandFixture()
    service.listCatalogAuthoringOperations.mockResolvedValue([
      catalogOperationFixture({
        actor_id: input.actorId,
        aggregate_id: input.assetId,
        command: input.command,
        expected_version: input.expectedVersion,
        id: "catop_existing",
        request_sha256: input.requestSha256,
        result: {
          assetId: input.assetId,
          lifecycleStatus: "quarantined",
          purgeEligibleAt: "2026-08-25T20:00:00.000Z",
          quarantinedAt: "2026-07-26T20:00:00.000Z",
          version: 2,
        },
        status: "succeeded",
      }),
    ])

    await expect(
      mutateCatalogMediaLifecycle(service as never, input)
    ).resolves.toMatchObject({
      assetId: "cmedia_1",
      lifecycleStatus: "quarantined",
      operationId: "catop_existing",
      replayed: true,
      version: 2,
    })
    expect(service.retrieveCatalogMediaAsset).not.toHaveBeenCalled()
    expect(service.updateCatalogMediaAssets).not.toHaveBeenCalled()

    await expect(
      mutateCatalogMediaLifecycle(service as never, {
        ...input,
        requestSha256: "b".repeat(64),
      })
    ).rejects.toThrow("cannot be replayed")

    service.listCatalogAuthoringOperations.mockResolvedValue([
      catalogOperationFixture({
        actor_id: input.actorId,
        aggregate_id: input.assetId,
        command: input.command,
        expected_version: input.expectedVersion,
        id: "catop_invalid",
        request_sha256: input.requestSha256,
        result: {},
        status: "succeeded",
      }),
    ])
    await expect(
      mutateCatalogMediaLifecycle(service as never, input)
    ).rejects.toThrow("transaction persistence boundary")
  })

  it("restores the full prior state when a later workflow step fails", async () => {
    const service = serviceFixture()
    const quarantinedAt = new Date("2026-07-01T00:00:00.000Z")
    const purgeEligibleAt = new Date("2026-07-31T00:00:00.000Z")
    service.listCatalogAuthoringOperations.mockResolvedValue([
      catalogOperationFixture({
        aggregate_id: "cmedia_1",
        command: "catalog.media.quarantine",
        expected_version: 1,
        id: "catop_1",
        metadata: { retention_days: 30 },
      }),
    ])
    service.updateCatalogAuthoringOperations.mockResolvedValue([
      catalogOperationFixture({
        aggregate_id: "cmedia_1",
        command: "catalog.media.quarantine",
        expected_version: 1,
        id: "catop_1",
        metadata: { retention_days: 30 },
        status: "compensated",
      }),
    ])

    await expect(
      compensateCatalogMediaLifecycle(service as never, {
        assetId: "cmedia_1",
        operationId: "catop_1",
        previous: {
          lifecycle_status: "quarantined",
          purge_eligible_at: purgeEligibleAt,
          quarantined_at: quarantinedAt,
          quarantined_by: "user_1",
          version: 2,
        },
      })
    ).resolves.toBeUndefined()
    expect(service.updateCatalogMediaAssets).toHaveBeenCalledWith(
      [
        {
          id: "cmedia_1",
          lifecycle_status: "quarantined",
          purge_eligible_at: purgeEligibleAt,
          quarantined_at: quarantinedAt,
          quarantined_by: "user_1",
          version: 2,
        },
      ],
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
