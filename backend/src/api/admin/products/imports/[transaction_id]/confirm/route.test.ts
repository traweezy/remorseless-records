import { EventEmitter } from "node:events"
import path from "node:path"

import { batchProductsWorkflow } from "@medusajs/core-flows"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import type { ILockingModule } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import {
  productImportLockKey,
  productImportWorkflowTransactionId,
} from "../../../../../../lib/catalog/product-import-contract"

import { POST } from "./route"

jest.mock("@medusajs/core-flows", () => ({
  batchProductsWorkflow: jest.fn(),
}))

const batchProductsWorkflowMock = batchProductsWorkflow as unknown as jest.Mock
const transactionId = "file_import_plan_01"

const importPlanBuffer = (overrides: Record<string, unknown> = {}): Buffer =>
  Buffer.from(
    JSON.stringify({
      create: [{ title: "New release" }],
      filename: "catalog.csv",
      generatedAt: new Date().toISOString(),
      update: [{ id: "prod_existing", title: "Existing release" }],
      ...overrides,
    }),
    "utf-8"
  )

type ResponseState = {
  body: unknown
  headers: Record<string, string>
  status: number
}

const responseFixture = (): {
  res: MedusaResponse
  state: ResponseState
} => {
  const state: ResponseState = { body: null, headers: {}, status: 200 }
  const response = new EventEmitter() as MedusaResponse
  response.setHeader = jest.fn((name: string, value: string) => {
    state.headers[name.toLowerCase()] = value
    return response
  }) as MedusaResponse["setHeader"]
  response.status = jest.fn((status: number) => {
    state.status = status
    return response
  }) as MedusaResponse["status"]
  response.json = jest.fn((body: unknown) => {
    state.body = body
    return response
  }) as MedusaResponse["json"]
  response.type = jest.fn(() => response) as MedusaResponse["type"]
  return { res: response, state }
}

const requestFixture = ({
  content = importPlanBuffer(),
  workflowResult = {
    created: [{ id: "prod_created" }],
    deleted: [],
    updated: [{ id: "prod_existing" }],
  },
}: {
  content?: unknown
  workflowResult?: unknown
} = {}) => {
  const run = jest.fn(async () => ({ result: workflowResult }))
  batchProductsWorkflowMock.mockReturnValue({ run })
  const fileService = {
    deleteFiles: jest.fn(async () => undefined),
    getAsBuffer: jest.fn(async () => content),
  }
  const locking = {
    acquire: jest
      .fn<Promise<void>, [string, { ownerId: string; expire: number }]>()
      .mockResolvedValue(undefined),
    release: jest
      .fn<Promise<boolean>, [string[], { ownerId: string }]>()
      .mockResolvedValue(true),
    execute: jest.fn(
      async (
        _key: string | string[],
        operation: () => Promise<unknown>,
        _options: { timeout: number }
      ) => operation()
    ),
  }
  const profiles = jest.fn().mockResolvedValue([])
  const media = jest.fn().mockResolvedValue([])
  const graph = jest.fn(async (input: { filters: { id: string[] } }) => ({
    data: input.filters.id.map((id) => ({ id })),
  }))
  const logger = {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  }
  const scope = {
    resolve: jest.fn((key: string) => {
      if (key === Modules.FILE) {
        return fileService
      }
      if (key === Modules.LOCKING) {
        return locking
      }
      if (key === "logger") {
        return logger
      }
      if (key === ContainerRegistrationKeys.QUERY) return { graph }
      if (key === "catalog")
        return {
          listCatalogProductProfiles: profiles,
          listCatalogProductMediaItems: media,
        }
      throw new Error(`Unexpected dependency: ${key}`)
    }),
  }
  const req = {
    headers: {},
    params: { transaction_id: transactionId },
    path: `/admin/products/imports/${transactionId}/confirm`,
    scope,
  } as unknown as MedusaRequest

  return {
    fileService,
    graph,
    locking,
    logger,
    media,
    profiles,
    req,
    run,
    scope,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe("POST /admin/products/imports/:transaction_id/confirm", () => {
  it("confirms an exact plan once under a distributed replay boundary", async () => {
    const fixture = requestFixture()
    const { res, state } = responseFixture()

    await POST(fixture.req, res)

    expect(fixture.locking.execute).toHaveBeenCalledWith(
      productImportLockKey(transactionId),
      expect.any(Function),
      { timeout: 5 }
    )
    expect(batchProductsWorkflowMock).toHaveBeenCalledWith(fixture.scope)
    expect(fixture.run).toHaveBeenCalledWith({
      context: {
        transactionId: productImportWorkflowTransactionId(transactionId),
      },
      input: {
        create: [expect.objectContaining({ title: "New release" })],
        update: [
          expect.objectContaining({
            id: "prod_existing",
            title: "Existing release",
          }),
        ],
      },
    })
    expect(fixture.fileService.deleteFiles).toHaveBeenCalledWith(transactionId)
    expect(state).toEqual({
      body: { summary: { toCreate: 1, toUpdate: 1 } },
      headers: { "cache-control": "no-store" },
      status: 202,
    })
    expect(JSON.stringify(fixture.logger.info.mock.calls)).not.toContain(
      transactionId
    )
  })

  it("rejects malformed plans before starting the workflow", async () => {
    const fixture = requestFixture({
      content: Buffer.from('{"create":[],"update":[]}'),
    })
    const { res } = responseFixture()

    await expect(POST(fixture.req, res)).rejects.toThrow(
      "The product import data is invalid."
    )
    expect(fixture.run).not.toHaveBeenCalled()
    expect(fixture.fileService.deleteFiles).not.toHaveBeenCalled()
  })

  it("rejects expired plans before starting the workflow", async () => {
    const fixture = requestFixture({
      content: importPlanBuffer({ generatedAt: "2026-01-01T00:00:00.000Z" }),
    })
    const { res } = responseFixture()

    await expect(POST(fixture.req, res)).rejects.toThrow(
      "The product import data is invalid."
    )
    expect(fixture.run).not.toHaveBeenCalled()
    expect(fixture.fileService.deleteFiles).not.toHaveBeenCalled()
  })

  it("rejects uploaded plan deletion instead of introducing batch deletion", async () => {
    const fixture = requestFixture({
      content: importPlanBuffer({ delete: ["prod_existing"] }),
    })
    const { res } = responseFixture()
    await expect(POST(fixture.req, res)).rejects.toThrow(
      "The product import data is invalid."
    )
    expect(fixture.run).not.toHaveBeenCalled()
    expect(fixture.graph).not.toHaveBeenCalled()
    expect(fixture.fileService.deleteFiles).not.toHaveBeenCalled()
  })

  it("keeps the plan when workflow acknowledgement is incomplete", async () => {
    const fixture = requestFixture({
      workflowResult: {
        created: [{ id: "prod_created" }],
        deleted: [],
        updated: [{ id: "prod_wrong" }],
      },
    })
    const { res } = responseFixture()

    await expect(POST(fixture.req, res)).rejects.toThrow(
      "The product import data is invalid."
    )
    expect(fixture.run).toHaveBeenCalledTimes(1)
    expect(fixture.fileService.deleteFiles).not.toHaveBeenCalled()
    expect(fixture.logger.error).toHaveBeenCalledWith(
      "[admin][products/imports] import confirmation failed."
    )
    expect(JSON.stringify(fixture.logger.error.mock.calls)).not.toContain(
      transactionId
    )
  })

  it.each([null, "", "https://example.test/requested.webp"])(
    "rejects a managed parsed thumbnail %j before any batch write",
    async (thumbnail) => {
      const fixture = requestFixture({
        content: importPlanBuffer({
          update: [{ id: "prod_existing", thumbnail }],
        }),
      })
      fixture.profiles.mockResolvedValue([
        { id: "cprof_existing", product_id: "prod_existing", version: 1 },
      ])
      const { res, state } = responseFixture()
      await POST(fixture.req, res)
      expect(state.status).toBe(409)
      expect(state.body).toMatchObject({
        code: "catalog_media_authoring_required",
      })
      expect(state.headers["cache-control"]).toBe("private, no-store")
      expect(fixture.run).not.toHaveBeenCalled()
      expect(fixture.fileService.deleteFiles).not.toHaveBeenCalled()
      expect(fixture.locking.acquire).toHaveBeenCalledWith(
        "catalog:product-media:prod_existing",
        { ownerId: expect.any(String), expire: 120, awaitQueue: false }
      )
      expect(fixture.locking.release).toHaveBeenCalledWith(
        ["catalog:product-media:prod_existing"],
        { ownerId: fixture.locking.acquire.mock.calls[0]![1].ownerId }
      )
    }
  )

  it("rejects a mixed parsed plan atomically and preserves its file", async () => {
    const fixture = requestFixture({
      content: importPlanBuffer({
        update: [
          { id: "prod_unmanaged", title: "Allowed", thumbnail: null },
          { id: "prod_managed", title: "Blocked", thumbnail: null },
        ],
      }),
    })
    fixture.profiles.mockResolvedValue([
      { id: "cprof_managed", product_id: "prod_managed", version: 2 },
    ])
    const { res, state } = responseFixture()
    await POST(fixture.req, res)
    expect(state.status).toBe(409)
    expect(fixture.locking.acquire.mock.calls.map(([key]) => key)).toEqual([
      "catalog:product-media:prod_managed",
      "catalog:product-media:prod_unmanaged",
    ])
    expect(fixture.run).not.toHaveBeenCalled()
    expect(fixture.fileService.deleteFiles).not.toHaveBeenCalled()
  })

  it("preserves unmanaged thumbnail assignments and native transaction audit", async () => {
    const fixture = requestFixture({
      content: importPlanBuffer({
        create: [{ title: "New", thumbnail: "https://example.test/new.webp" }],
        update: [
          {
            id: "prod_existing",
            title: "Changed",
            thumbnail: "https://example.test/legacy.webp",
          },
        ],
      }),
    })
    const { res, state } = responseFixture()
    await POST(fixture.req, res)
    expect(state.status).toBe(202)
    expect(fixture.run).toHaveBeenCalledWith({
      context: {
        transactionId: productImportWorkflowTransactionId(transactionId),
      },
      input: {
        create: [
          expect.objectContaining({
            thumbnail: "https://example.test/new.webp",
          }),
        ],
        update: [
          expect.objectContaining({
            id: "prod_existing",
            thumbnail: "https://example.test/legacy.webp",
          }),
        ],
      },
    })
    expect(fixture.fileService.deleteFiles).toHaveBeenCalledTimes(1)
  })

  it("does not limit valid import targets to the native HTTP batch bound", async () => {
    const updates = Array.from({ length: 101 }, (_, index) => ({
      id: `prod_${index}`,
      thumbnail: null,
    }))
    const fixture = requestFixture({
      content: importPlanBuffer({ create: [], update: updates }),
      workflowResult: { created: [], updated: updates, deleted: [] },
    })
    const { res, state } = responseFixture()
    await POST(fixture.req, res)
    expect(state.status).toBe(202)
    expect(fixture.locking.acquire).toHaveBeenCalledTimes(101)
    expect(fixture.run).toHaveBeenCalledTimes(1)
  })

  it("leaves ordinary fields on managed products and new imports unchanged", async () => {
    const fixture = requestFixture({
      content: importPlanBuffer({
        create: [{ title: "New", thumbnail: "https://example.test/new.webp" }],
        update: [
          { id: "prod_existing", title: "Renamed", description: "Copy" },
        ],
      }),
    })
    const { res, state } = responseFixture()
    await POST(fixture.req, res)
    expect(state.status).toBe(202)
    expect(fixture.graph).not.toHaveBeenCalled()
    expect(fixture.profiles).not.toHaveBeenCalled()
    expect(fixture.media).not.toHaveBeenCalled()
    expect(fixture.locking.execute).toHaveBeenCalledTimes(1)
  })

  it.each([
    { id: "variant_existing", thumbnail: null },
    { title: "New variant", thumbnail: "https://example.test/new.webp" },
  ])(
    "retains the installed import DTO rejection for nested thumbnails %j",
    async (variant) => {
      const fixture = requestFixture({
        content: importPlanBuffer({
          update: [{ id: "prod_existing", variants: [variant] }],
        }),
      })
      const { res } = responseFixture()
      await expect(POST(fixture.req, res)).rejects.toThrow(
        "The product import data is invalid."
      )
      expect(fixture.run).not.toHaveBeenCalled()
      expect(fixture.graph).not.toHaveBeenCalled()
      expect(fixture.fileService.deleteFiles).not.toHaveBeenCalled()
    }
  )

  it("rechecks current ownership inside the product media lock", async () => {
    const fixture = requestFixture({
      content: importPlanBuffer({
        update: [{ id: "prod_existing", thumbnail: null }],
      }),
    })
    fixture.locking.acquire.mockImplementation(async () => {
      fixture.profiles.mockResolvedValue([
        { id: "cprof_existing", product_id: "prod_existing", version: 1 },
      ])
    })
    const { res, state } = responseFixture()
    await POST(fixture.req, res)
    expect(state.status).toBe(409)
    expect(fixture.run).not.toHaveBeenCalled()
    expect(fixture.fileService.deleteFiles).not.toHaveBeenCalled()
  })

  it.each(["missing", "unavailable"])(
    "fails closed on %s ownership without consuming the plan",
    async (failure) => {
      const fixture = requestFixture({
        content: importPlanBuffer({
          update: [{ id: "prod_existing", thumbnail: null }],
        }),
      })
      if (failure === "missing") fixture.graph.mockResolvedValue({ data: [] })
      else
        fixture.profiles.mockRejectedValue(new Error("Ownership unavailable"))
      const { res } = responseFixture()
      await expect(POST(fixture.req, res)).rejects.toThrow()
      expect(fixture.run).not.toHaveBeenCalled()
      expect(fixture.fileService.deleteFiles).not.toHaveBeenCalled()
    }
  )

  it("holds actual native import completion through disconnect before releasing media locks", async () => {
    const fixture = requestFixture({
      content: importPlanBuffer({
        update: [{ id: "prod_existing", thumbnail: null }],
      }),
    })
    const { res } = responseFixture()
    const medusaDirectory = path.dirname(require.resolve("@medusajs/medusa"))
    const lockingPath = require.resolve("@medusajs/locking-redis", {
      paths: [medusaDirectory],
    })
    jest.doMock("node:timers/promises", () => ({
      setTimeout: (delay: number) =>
        new Promise((resolve) => setTimeout(resolve, delay)),
    }))
    const { RedisLockingProvider } = jest.requireActual<{
      RedisLockingProvider: new (
        container: object,
        options: object
      ) => Pick<ILockingModule, "acquire" | "release" | "execute">
    }>(path.join(path.dirname(lockingPath), "services/redis-lock.js"))
    const held = new Map<string, string>()
    const releaseLock = jest.fn(async (key: string, owner: string) => {
      if (held.get(key) !== owner) return 0
      return Number(held.delete(key))
    })
    const locking = new RedisLockingProvider(
      {
        redisClient: {
          defineCommand: jest.fn(),
          acquireLock: jest.fn(async (key: string, owner: string) => {
            if (held.has(key)) return 0
            held.set(key, owner)
            return 1
          }),
          releaseLock,
        },
      },
      {}
    )
    let complete: (value: { result: unknown }) => void = () => undefined
    fixture.run.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve
      })
    )
    fixture.locking.execute.mockImplementation((keys, operation, options) =>
      locking.execute(keys, operation, options)
    )
    fixture.locking.acquire.mockImplementation((key, options) =>
      locking.acquire(key, options)
    )
    fixture.locking.release.mockImplementation((keys, options) =>
      locking.release(keys, options)
    )
    jest.useFakeTimers()
    try {
      const confirmation = POST(fixture.req, res)
      for (let count = 0; count < 60 && !fixture.run.mock.calls.length; count++)
        await Promise.resolve()
      expect(fixture.run).toHaveBeenCalledTimes(1)
      const adoption = jest.fn().mockResolvedValue(undefined)
      const adopted = locking.execute(
        ["catalog:product-media:prod_existing"],
        adoption,
        { timeout: 120 }
      )
      res.emit("close")
      await jest.advanceTimersByTimeAsync(100)
      expect(adoption).not.toHaveBeenCalled()
      expect(releaseLock).not.toHaveBeenCalled()
      expect(fixture.fileService.deleteFiles).not.toHaveBeenCalled()
      complete({
        result: {
          created: [{ id: "prod_created" }],
          updated: [{ id: "prod_existing" }],
          deleted: [],
        },
      })
      await confirmation
      await jest.advanceTimersByTimeAsync(1000)
      await adopted
      expect(adoption).toHaveBeenCalledTimes(1)
      expect(held.size).toBe(0)
      expect(fixture.fileService.deleteFiles).toHaveBeenCalledTimes(1)
    } finally {
      jest.clearAllTimers()
      jest.useRealTimers()
    }
  })
})
