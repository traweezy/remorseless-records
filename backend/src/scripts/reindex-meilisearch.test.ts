import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  assertTaskSucceeded,
  ensureIndexExists,
  upsertAllProductDocuments,
} from "./reindex-meilisearch"

describe("ensureIndexExists", () => {
  const missing = () =>
    Object.assign(new Error("Index not found"), {
      name: "MeiliSearchApiError",
      cause: { code: "index_not_found" },
    })
  const fixture = () => ({
    indexKey: "products_build_20261003t000542868z_fixture",
    index: {
      getStats: jest.fn().mockResolvedValue({ numberOfDocuments: 0 }),
      getSettings: jest.fn(),
      updateSettings: jest.fn(),
      deleteAllDocuments: jest.fn(),
      deleteDocuments: jest.fn(),
      tasks: {
        waitForTask: jest.fn().mockResolvedValue({ status: "succeeded" }),
      },
    },
    meilisearch: {
      createIndex: jest.fn().mockResolvedValue({ taskUid: 42 }),
    },
  })

  it("preserves existing indexes for the caller's retry cleanup", async () => {
    const input = fixture()
    await expect(ensureIndexExists(input)).resolves.toBe(true)
    expect(input.meilisearch.createIndex).not.toHaveBeenCalled()
  })

  it.each([missing(), { code: "index_not_found" }])(
    "creates missing indexes using SDK and legacy error shapes",
    async (error) => {
      const input = fixture()
      input.index.getStats.mockRejectedValueOnce(error)
      await expect(ensureIndexExists(input)).resolves.toBe(false)
      expect(input.meilisearch.createIndex).toHaveBeenCalledWith(
        input.indexKey,
        { primaryKey: "id" }
      )
      expect(input.index.tasks.waitForTask).toHaveBeenCalledWith(
        { taskUid: 42 },
        { timeout: 120_000, interval: 100 }
      )
      expect(input.index.getStats).toHaveBeenCalledTimes(2)
    }
  )

  it("accepts a concurrent creator only after the index is readable", async () => {
    const input = fixture()
    input.index.getStats.mockRejectedValueOnce(missing())
    input.index.tasks.waitForTask.mockResolvedValueOnce({
      status: "failed",
      error: { code: "index_already_exists" },
    })
    await expect(ensureIndexExists(input)).resolves.toBe(true)
    expect(input.index.getStats).toHaveBeenCalledTimes(2)
  })

  it.each([
    new Error("Connection unavailable"),
    { cause: { code: "invalid_api_key" } },
    { code: "invalid_api_key", cause: { code: "index_not_found" } },
    { cause: [{ code: "index_not_found" }] },
    null,
  ])("never creates an index for other failures", async (error) => {
    const input = fixture()
    input.index.getStats.mockRejectedValueOnce(error)
    await expect(ensureIndexExists(input)).rejects.toBe(error)
    expect(input.meilisearch.createIndex).not.toHaveBeenCalled()
  })

  it.each([
    { status: "failed", error: { code: "invalid_api_key" } },
    { status: "canceled", error: { code: "index_already_exists" } },
    { status: "processing" },
  ])("rejects unsuccessful creation tasks", async (task) => {
    const input = fixture()
    input.index.getStats.mockRejectedValueOnce(missing())
    input.index.tasks.waitForTask.mockResolvedValueOnce(task)
    await expect(ensureIndexExists(input)).rejects.toThrow(/create '/)
    expect(input.index.getStats).toHaveBeenCalledTimes(1)
  })

  it.each(["succeeded", "failed"])(
    "requires read-back even after a %s creation result",
    async (status) => {
      const input = fixture()
      input.index.getStats.mockRejectedValue(missing())
      input.index.tasks.waitForTask.mockResolvedValueOnce({
        status,
        error: { code: "index_already_exists" },
      })
      await expect(ensureIndexExists(input)).rejects.toThrow("Index not found")
    }
  )
})

describe("assertTaskSucceeded", () => {
  it("accepts a completed Meilisearch task", () => {
    expect(() =>
      assertTaskSucceeded({ status: "succeeded" }, "catalog batch")
    ).not.toThrow()
  })

  it("rejects failed and canceled Meilisearch tasks", () => {
    expect(() =>
      assertTaskSucceeded(
        { status: "failed", error: { message: "bad document" } },
        "catalog batch"
      )
    ).toThrow("catalog batch failed")
    expect(() =>
      assertTaskSucceeded({ status: "canceled" }, "catalog batch")
    ).toThrow("catalog batch canceled")
  })

  it("loads rebuild documents through the configured query graph fields", async () => {
    const graph = jest
      .fn()
      .mockResolvedValueOnce({ data: [{ id: "prod_1" }] })
      .mockResolvedValueOnce({ data: [] })
    const waitForTask = jest.fn().mockResolvedValue({ status: "succeeded" })
    const getFieldsForType = jest
      .fn()
      .mockResolvedValue(["id", "variants.prices.*"])
    const addDocuments = jest.fn().mockResolvedValue({ taskUid: 1 })
    const logger = { info: jest.fn() }
    const meilisearch = {
      getFieldsForType,
      getIndex: jest.fn().mockReturnValue({ tasks: { waitForTask } }),
      addDocuments,
    }
    const container = {
      hasRegistration: jest.fn().mockReturnValue(true),
      resolve: jest.fn((key: string) => {
        if (key === ContainerRegistrationKeys.LOGGER) {
          return logger
        }
        if (key === ContainerRegistrationKeys.QUERY) {
          return { graph }
        }
        if (key === "meilisearch") {
          return meilisearch
        }
        throw new Error(`Unexpected registration: ${key}`)
      }),
    }

    await expect(
      upsertAllProductDocuments({
        container: container as never,
        reason: "test rebuild",
      })
    ).resolves.toBe(1)

    expect(getFieldsForType).toHaveBeenCalledWith("products")
    expect(graph).toHaveBeenNthCalledWith(1, {
      entity: "product",
      fields: ["id", "variants.prices.*"],
      filters: { status: "published" },
      pagination: { skip: 0, take: 100 },
    })
    expect(addDocuments).toHaveBeenCalledWith(
      "products",
      [{ id: "prod_1" }],
      "products",
      { container }
    )
  })
})
