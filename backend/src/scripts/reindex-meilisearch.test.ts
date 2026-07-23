import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  assertTaskSucceeded,
  upsertAllProductDocuments,
} from "./reindex-meilisearch"

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
