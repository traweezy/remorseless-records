import type { MedusaRequest } from "@medusajs/framework"

import type { CatalogService } from "../utils"
import {
  loadShelfProductsByShelfId,
  prepareShelfProducts,
  resolveUniqueShelfHandle,
  setShelfArchived,
  shelfUpsertSchema,
  upsertShelf,
} from "./helpers"

const operationId = "catop_01"
const shelfId = "cshelf_01"
const idempotencyKey = "8bff4ab1-0d8b-4b73-a928-856272bfac81"

const shelfRecord = (patch: Record<string, unknown> = {}) => ({
  archived_at: null,
  automation_type: "none",
  description: null,
  ends_at: null,
  handle: "featured",
  id: shelfId,
  is_active: true,
  metadata: {},
  mode: "manual",
  product_limit: null,
  ribbon_label: null,
  ribbon_priority: 100,
  show_ribbon: false,
  starts_at: null,
  title: "Featured",
  version: 1,
  ...patch,
})

const shelfProductRecord = (
  id: string,
  productId: string,
  sortOrder: number,
  shelf = shelfId
) => ({
  ends_at: null,
  id,
  is_pinned: false,
  metadata: {},
  product_id: productId,
  product_profile_id: null,
  shelf_id: shelf,
  sort_order: sortOrder,
  starts_at: null,
})

const requestWithProducts = (productIds: string[]) => {
  const graph = jest.fn().mockResolvedValue({
    data: productIds.map((id) => ({ id })),
  })
  const req = {
    auth_context: { actor_id: "user_01" },
    scope: { resolve: jest.fn().mockReturnValue({ graph }) },
  } as unknown as MedusaRequest
  return { graph, req }
}

const transactionService = (overrides: Record<string, unknown> = {}) => {
  const sharedContext = { transactionManager: { id: "tx" } }
  let storedOperation: Record<string, unknown> | null = null
  const service = {
    createCatalogAuthoringOperations: jest
      .fn()
      .mockImplementation(async (payloads: Record<string, unknown>[]) =>
        payloads.map((payload) => {
          storedOperation = {
            ...payload,
            completed_at: null,
            error_code: null,
            error_detail: null,
            id: operationId,
          }
          return storedOperation
        })
      ),
    createCatalogShelfProducts: jest
      .fn()
      .mockImplementation(async (payloads: Record<string, unknown>[]) =>
        payloads.map((payload, index) => ({
          ...payload,
          id: `cshelfp_created_${index + 1}`,
        }))
      ),
    createCatalogShelves: jest.fn(),
    deleteCatalogShelfProducts: jest.fn().mockResolvedValue(undefined),
    listCatalogAuthoringOperations: jest.fn().mockResolvedValue([]),
    listCatalogShelves: jest.fn().mockResolvedValue([]),
    listCatalogShelfProducts: jest.fn().mockResolvedValue([]),
    retrieveCatalogShelf: jest.fn(),
    runCatalogTransaction: jest.fn(
      async (task: (context: unknown) => Promise<unknown>) =>
        task(sharedContext)
    ),
    updateCatalogAuthoringOperations: jest
      .fn()
      .mockImplementation(async (payloads: Record<string, unknown>[]) =>
        payloads.map((payload) => {
          storedOperation = { ...storedOperation, ...payload }
          return storedOperation
        })
      ),
    updateCatalogShelves: jest.fn(),
    ...overrides,
  }
  return {
    service: service as unknown as CatalogService,
    sharedContext,
    spies: service,
  }
}

describe("catalog shelf authoring", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-02T03:30:00.000Z"))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it("validates every product before returning normalized membership rows", async () => {
    const { graph, req } = requestWithProducts(["prod_01", "prod_02"])
    const service = {
      listCatalogProductProfiles: jest.fn().mockResolvedValue([]),
    } as unknown as CatalogService

    const result = await prepareShelfProducts(req, service, [
      { productId: "prod_01", isPinned: true },
      {
        productId: "prod_02",
        sortOrder: 9,
        startsAt: "2026-08-02T12:00:00.000Z",
        endsAt: "2026-08-03T12:00:00.000Z",
      },
    ])

    expect(graph).toHaveBeenCalledTimes(1)
    expect(graph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "product",
        filters: { id: ["prod_01", "prod_02"] },
        pagination: { take: 2 },
      })
    )
    expect(result).toEqual([
      expect.objectContaining({
        is_pinned: true,
        product_id: "prod_01",
        sort_order: 0,
      }),
      expect.objectContaining({
        product_id: "prod_02",
        sort_order: 9,
      }),
    ])
  })

  it("rejects duplicate and invalid-date memberships before product I/O", async () => {
    const { graph, req } = requestWithProducts(["prod_01"])
    const service = {
      listCatalogProductProfiles: jest.fn().mockResolvedValue([]),
    } as unknown as CatalogService

    await expect(
      prepareShelfProducts(req, service, [
        { productId: "prod_01" },
        { productId: "prod_01" },
      ])
    ).rejects.toThrow("same product more than once")
    await expect(
      prepareShelfProducts(req, service, [
        {
          productId: "prod_01",
          startsAt: "2026-08-03T12:00:00.000Z",
          endsAt: "2026-08-02T12:00:00.000Z",
        },
      ])
    ).rejects.toThrow("End date must be after start date")
    expect(graph).not.toHaveBeenCalled()
  })

  it("rejects malformed dates and mismatched product profiles at the boundary", async () => {
    expect(
      shelfUpsertSchema.safeParse({
        expectedVersion: 1,
        idempotencyKey,
        startsAt: "not-a-date",
      }).success
    ).toBe(false)

    const { req } = requestWithProducts(["prod_01"])
    const service = {
      listCatalogProductProfiles: jest
        .fn()
        .mockResolvedValue([{ id: "cprof_01", product_id: "prod_other" }]),
    } as unknown as CatalogService
    await expect(
      prepareShelfProducts(req, service, [
        { productId: "prod_01", productProfileId: "cprof_01" },
      ])
    ).rejects.toThrow("must belong to its selected product")
  })

  it("loads memberships for every listed shelf with one bounded query", async () => {
    const listCatalogShelfProducts = jest
      .fn()
      .mockResolvedValue([
        shelfProductRecord("cshelfp_02", "prod_02", 0, "cshelf_02"),
        shelfProductRecord("cshelfp_01", "prod_01", 0),
      ])
    const service = {
      listCatalogShelfProducts,
    } as unknown as CatalogService

    const result = await loadShelfProductsByShelfId(service, [
      shelfId,
      "cshelf_02",
      shelfId,
    ])

    expect(listCatalogShelfProducts).toHaveBeenCalledTimes(1)
    expect(listCatalogShelfProducts).toHaveBeenCalledWith(
      { shelf_id: [shelfId, "cshelf_02"] },
      { order: { sort_order: "ASC", id: "ASC" }, take: 400 }
    )
    expect(result.get(shelfId)?.map((line) => line.productId)).toEqual([
      "prod_01",
    ])
    expect(result.get("cshelf_02")?.map((line) => line.productId)).toEqual([
      "prod_02",
    ])
  })

  it("saves metadata and memberships in one versioned transaction", async () => {
    const before = shelfRecord()
    const after = shelfRecord({ title: "New title", version: 2 })
    const oldLine = shelfProductRecord("cshelfp_old", "prod_old", 0)
    const newLine = shelfProductRecord("cshelfp_new", "prod_01", 0)
    const { req, graph } = requestWithProducts(["prod_01"])
    const { service, sharedContext, spies } = transactionService({
      listCatalogShelfProducts: jest
        .fn()
        .mockResolvedValueOnce([oldLine])
        .mockResolvedValueOnce([newLine]),
      retrieveCatalogShelf: jest
        .fn()
        .mockResolvedValueOnce(before)
        .mockResolvedValueOnce(after)
        .mockResolvedValueOnce(after),
      updateCatalogShelves: jest.fn().mockResolvedValue([after]),
    })

    const response = await upsertShelf(
      req,
      service,
      {
        expectedVersion: 1,
        idempotencyKey,
        products: [{ productId: "prod_01" }],
        title: "New title",
      },
      shelfId
    )

    expect(graph.mock.invocationCallOrder[0]).toBeLessThan(
      spies.deleteCatalogShelfProducts.mock.invocationCallOrder[0] ?? 0
    )
    expect(spies.updateCatalogShelves).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: shelfId,
          title: "New title",
          version: 2,
        }),
      ],
      sharedContext
    )
    expect(spies.deleteCatalogShelfProducts).toHaveBeenCalledWith(
      ["cshelfp_old"],
      sharedContext
    )
    expect(spies.createCatalogShelfProducts).toHaveBeenCalledWith(
      [expect.objectContaining({ product_id: "prod_01", shelf_id: shelfId })],
      sharedContext
    )
    expect(spies.updateCatalogAuthoringOperations).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: operationId,
          result: { created: false, shelfId, version: 2 },
          status: "succeeded",
        }),
      ],
      sharedContext
    )
    expect(response.body.shelf.version).toBe(2)
  })

  it("creates a complete shelf and verifies its exact acknowledgement", async () => {
    const created = shelfRecord({
      handle: "new-shelf",
      id: "cshelf_created",
      title: "New shelf",
    })
    const { req } = requestWithProducts([])
    const { service, sharedContext, spies } = transactionService({
      createCatalogShelves: jest.fn().mockResolvedValue([created]),
      retrieveCatalogShelf: jest.fn().mockResolvedValue(created),
    })

    const response = await upsertShelf(req, service, {
      expectedVersion: 0,
      idempotencyKey,
      title: "New shelf",
    })

    expect(spies.createCatalogShelves).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          archived_at: null,
          handle: "new-shelf",
          metadata: {},
          title: "New shelf",
          version: 1,
        }),
      ],
      sharedContext
    )
    expect(response).toMatchObject({
      body: { shelf: { id: "cshelf_created", version: 1 } },
      status: 201,
    })
  })

  it("fails deterministically after exhausting unique handle candidates", async () => {
    const listCatalogShelves = jest
      .fn()
      .mockImplementation(async ({ handle }: { handle: string }) => [
        shelfRecord({ handle, id: "cshelf_collision" }),
      ])
    const service = { listCatalogShelves } as unknown as CatalogService

    await expect(resolveUniqueShelfHandle(service, "featured")).rejects.toThrow(
      "Choose a more specific handle"
    )
    expect(listCatalogShelves).toHaveBeenCalledTimes(50)
    expect(listCatalogShelves).toHaveBeenLastCalledWith({
      handle: "featured-49",
    })
  })

  it("rejects a stale version before creating an operation or mutating rows", async () => {
    const { req } = requestWithProducts([])
    const { service, spies } = transactionService({
      retrieveCatalogShelf: jest
        .fn()
        .mockResolvedValue(shelfRecord({ version: 2 })),
    })

    await expect(
      upsertShelf(
        req,
        service,
        { expectedVersion: 1, idempotencyKey, title: "Stale" },
        shelfId
      )
    ).rejects.toThrow("changed after it was loaded")
    expect(spies.createCatalogAuthoringOperations).not.toHaveBeenCalled()
    expect(spies.updateCatalogShelves).not.toHaveBeenCalled()
  })

  it("maps a serializable-write collision to a merchant-readable conflict", async () => {
    const { req } = requestWithProducts([])
    const { service } = transactionService({
      runCatalogTransaction: jest.fn().mockRejectedValue({
        cause: { code: "40001" },
        message: "wrapped transaction failure",
      }),
    })

    await expect(
      upsertShelf(
        req,
        service,
        { expectedVersion: 1, idempotencyKey, title: "Concurrent" },
        shelfId
      )
    ).rejects.toThrow("changed while it was being saved")
  })

  it("does not mark a command complete when membership persistence fails", async () => {
    const { req } = requestWithProducts(["prod_01"])
    const { service, spies } = transactionService({
      createCatalogShelfProducts: jest
        .fn()
        .mockRejectedValue(new Error("injected membership failure")),
      listCatalogShelfProducts: jest
        .fn()
        .mockResolvedValue([shelfProductRecord("cshelfp_old", "prod_old", 0)]),
      retrieveCatalogShelf: jest
        .fn()
        .mockResolvedValueOnce(shelfRecord())
        .mockResolvedValueOnce(shelfRecord({ version: 2 })),
      updateCatalogShelves: jest
        .fn()
        .mockResolvedValue([shelfRecord({ version: 2 })]),
    })

    await expect(
      upsertShelf(
        req,
        service,
        {
          expectedVersion: 1,
          idempotencyKey,
          products: [{ productId: "prod_01" }],
        },
        shelfId
      )
    ).rejects.toThrow("injected membership failure")
    expect(spies.deleteCatalogShelfProducts).toHaveBeenCalled()
    expect(spies.updateCatalogAuthoringOperations).not.toHaveBeenCalled()
  })

  it("rejects a partial audit-operation creation acknowledgement", async () => {
    const { req } = requestWithProducts([])
    const { service, spies } = transactionService({
      createCatalogAuthoringOperations: jest
        .fn()
        .mockResolvedValue([{ id: operationId }]),
      retrieveCatalogShelf: jest.fn().mockResolvedValue(shelfRecord()),
    })

    await expect(
      upsertShelf(
        req,
        service,
        { expectedVersion: 1, idempotencyKey, title: "Updated" },
        shelfId
      )
    ).rejects.toThrow(
      "The catalog shelf persistence boundary returned invalid structured data."
    )
    expect(spies.updateCatalogShelves).not.toHaveBeenCalled()
  })

  it("rejects a mismatched shelf mutation acknowledgement", async () => {
    const { req } = requestWithProducts([])
    const { service, spies } = transactionService({
      retrieveCatalogShelf: jest.fn().mockResolvedValue(shelfRecord()),
      updateCatalogShelves: jest
        .fn()
        .mockResolvedValue([shelfRecord({ id: "cshelf_other", version: 2 })]),
    })

    await expect(
      upsertShelf(
        req,
        service,
        { expectedVersion: 1, idempotencyKey, title: "Updated" },
        shelfId
      )
    ).rejects.toThrow(
      "The catalog shelf persistence boundary returned invalid structured data."
    )
    expect(spies.updateCatalogAuthoringOperations).not.toHaveBeenCalled()
  })

  it("rejects membership creation that acknowledges the wrong Product", async () => {
    const { req } = requestWithProducts(["prod_01"])
    const { service, spies } = transactionService({
      createCatalogShelfProducts: jest
        .fn()
        .mockResolvedValue([
          shelfProductRecord("cshelfp_wrong", "prod_other", 0),
        ]),
      listCatalogShelfProducts: jest
        .fn()
        .mockResolvedValue([shelfProductRecord("cshelfp_old", "prod_old", 0)]),
      retrieveCatalogShelf: jest.fn().mockResolvedValue(shelfRecord()),
      updateCatalogShelves: jest
        .fn()
        .mockResolvedValue([shelfRecord({ version: 2 })]),
    })

    await expect(
      upsertShelf(
        req,
        service,
        {
          expectedVersion: 1,
          idempotencyKey,
          products: [{ productId: "prod_01" }],
        },
        shelfId
      )
    ).rejects.toThrow(
      "The catalog shelf persistence boundary returned invalid structured data."
    )
    expect(spies.updateCatalogAuthoringOperations).not.toHaveBeenCalled()
  })

  it("rejects a malformed audit completion acknowledgement", async () => {
    const { req } = requestWithProducts([])
    const { service } = transactionService({
      retrieveCatalogShelf: jest.fn().mockResolvedValue(shelfRecord()),
      updateCatalogAuthoringOperations: jest.fn().mockResolvedValue([null]),
      updateCatalogShelves: jest
        .fn()
        .mockResolvedValue([shelfRecord({ version: 2 })]),
    })

    await expect(
      upsertShelf(
        req,
        service,
        { expectedVersion: 1, idempotencyKey, title: "Updated" },
        shelfId
      )
    ).rejects.toThrow(
      "The catalog shelf persistence boundary returned invalid structured data."
    )
  })

  it("rejects completion of a different audit operation", async () => {
    const { req } = requestWithProducts([])
    let pendingOperation: Record<string, unknown> | null = null
    const { service } = transactionService({
      createCatalogAuthoringOperations: jest
        .fn()
        .mockImplementation(async (payloads: Record<string, unknown>[]) =>
          payloads.map((payload) => {
            pendingOperation = {
              ...payload,
              completed_at: null,
              error_code: null,
              error_detail: null,
              id: operationId,
            }
            return pendingOperation
          })
        ),
      retrieveCatalogShelf: jest.fn().mockResolvedValue(shelfRecord()),
      updateCatalogAuthoringOperations: jest
        .fn()
        .mockImplementation(async (payloads: Record<string, unknown>[]) =>
          payloads.map((payload) => ({
            ...pendingOperation,
            ...payload,
            id: "catop_other",
          }))
        ),
      updateCatalogShelves: jest
        .fn()
        .mockResolvedValue([shelfRecord({ version: 2 })]),
    })

    await expect(
      upsertShelf(
        req,
        service,
        { expectedVersion: 1, idempotencyKey, title: "Updated" },
        shelfId
      )
    ).rejects.toThrow(
      "The catalog shelf persistence boundary returned invalid structured data."
    )
  })

  it("replays an identical completed command without a second write", async () => {
    const { req } = requestWithProducts([])
    const completed = {
      actor_id: "user_01",
      aggregate_id: shelfId,
      command: "catalog.shelf.upsert",
      expected_version: 1,
      completed_at: new Date("2026-08-02T03:30:00.000Z"),
      error_code: null,
      error_detail: null,
      id: operationId,
      idempotency_key: idempotencyKey,
      metadata: {},
      request_sha256: "placeholder",
      result: { created: false, shelfId, version: 2 },
      status: "succeeded",
    }
    const first = transactionService({
      retrieveCatalogShelf: jest
        .fn()
        .mockResolvedValueOnce(shelfRecord())
        .mockResolvedValueOnce(shelfRecord({ title: "Updated", version: 2 })),
      updateCatalogShelves: jest
        .fn()
        .mockResolvedValue([shelfRecord({ title: "Updated", version: 2 })]),
    })
    await upsertShelf(
      req,
      first.service,
      { expectedVersion: 1, idempotencyKey, title: "Updated" },
      shelfId
    )
    const requestSha256 = first.spies.createCatalogAuthoringOperations.mock
      .calls[0]?.[0]?.[0]?.request_sha256 as string
    const replay = transactionService({
      listCatalogAuthoringOperations: jest
        .fn()
        .mockResolvedValue([{ ...completed, request_sha256: requestSha256 }]),
      retrieveCatalogShelf: jest
        .fn()
        .mockResolvedValue(shelfRecord({ title: "Updated", version: 2 })),
    })

    const response = await upsertShelf(
      req,
      replay.service,
      { expectedVersion: 1, idempotencyKey, title: "Updated" },
      shelfId
    )

    expect(response.body.shelf.version).toBe(2)
    expect(replay.spies.createCatalogAuthoringOperations).not.toHaveBeenCalled()
    expect(replay.spies.updateCatalogShelves).not.toHaveBeenCalled()
  })

  it("archives and restores without deleting shelf membership", async () => {
    const { req } = requestWithProducts([])
    const archivedRecord = shelfRecord({
      archived_at: new Date("2026-08-02T03:30:00.000Z"),
      is_active: false,
      version: 2,
    })
    const archive = transactionService({
      retrieveCatalogShelf: jest
        .fn()
        .mockResolvedValueOnce(shelfRecord())
        .mockResolvedValueOnce(archivedRecord),
      updateCatalogShelves: jest.fn().mockResolvedValue([archivedRecord]),
    })

    const archived = await setShelfArchived(
      req,
      archive.service,
      shelfId,
      { expectedVersion: 1, idempotencyKey },
      true
    )

    expect(archive.spies.updateCatalogShelves).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          archived_at: expect.any(Date),
          id: shelfId,
          is_active: false,
          version: 2,
        }),
      ],
      archive.sharedContext
    )
    expect(archive.spies.deleteCatalogShelfProducts).not.toHaveBeenCalled()
    expect(archived.shelf.archivedAt).toBe("2026-08-02T03:30:00.000Z")

    const restoreKey = "26a5c95d-0271-4fd9-a296-9e7275e6fddd"
    const restoredRecord = shelfRecord({ is_active: false, version: 3 })
    const restore = transactionService({
      retrieveCatalogShelf: jest
        .fn()
        .mockResolvedValueOnce(archivedRecord)
        .mockResolvedValueOnce(restoredRecord),
      updateCatalogShelves: jest.fn().mockResolvedValue([restoredRecord]),
    })
    const restored = await setShelfArchived(
      req,
      restore.service,
      shelfId,
      { expectedVersion: 2, idempotencyKey: restoreKey },
      false
    )

    expect(restore.spies.updateCatalogShelves).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          archived_at: null,
          id: shelfId,
          is_active: false,
          version: 3,
        }),
      ],
      restore.sharedContext
    )
    expect(restored.shelf.archivedAt).toBeNull()
  })
})
