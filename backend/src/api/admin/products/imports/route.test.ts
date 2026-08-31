import type { MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { productImportLockKey } from "../../../../lib/catalog/product-import-contract"

import { POST, reuseResolvedProductOptions } from "./route"

describe("product import option reuse", () => {
  it("reuses the oldest matching option instead of creating a duplicate", () => {
    const product = {
      id: "prod_1",
      handle: "music-release-artist-album",
      options: [{ title: "Format", values: ["CD", "Vinyl"] }],
    }

    reuseResolvedProductOptions(product, [
      {
        id: "opt_newer",
        title: "Format",
        values: ["CD", "Vinyl"],
        createdAt: "2026-07-19T16:34:00.000Z",
      },
      {
        id: "opt_original",
        title: "Format",
        values: ["Vinyl", "CD"],
        createdAt: "2026-07-19T16:33:00.000Z",
      },
    ])

    expect(product).toEqual({
      id: "prod_1",
      handle: "music-release-artist-album",
      option_ids: ["opt_original"],
    })
  })

  it("rejects new values that are absent from the existing option", () => {
    const product = {
      id: "prod_1",
      handle: "music-release-artist-album",
      options: [{ title: "Format", values: ["Cassette"] }],
    }

    expect(() =>
      reuseResolvedProductOptions(product, [
        {
          id: "opt_format",
          title: "Format",
          values: ["CD"],
          createdAt: "2026-07-19T16:33:00.000Z",
        },
      ])
    ).toThrow(MedusaError)
    expect(product.options).toBeDefined()
  })
})

type ResponseState = {
  body: unknown
  status: number
}

const responseFixture = (): {
  res: MedusaResponse
  state: ResponseState
} => {
  const state: ResponseState = { body: null, status: 200 }
  const response = {} as MedusaResponse
  response.status = jest.fn((status: number) => {
    state.status = status
    return response
  }) as MedusaResponse["status"]
  response.json = jest.fn((body: unknown) => {
    state.body = body
    return response
  }) as MedusaResponse["json"]
  return { res: response, state }
}

const requestFixture = ({
  content = Buffer.from(
    "Product Handle,Product Title,Variant Title\nnew-release,New Release,Default\n",
    "utf-8"
  ),
  createResult = { id: "file_plan_01", url: "memory://file_plan_01" },
  deleteFiles = jest.fn(async () => undefined),
  graphResult = { data: [] },
}: {
  content?: unknown
  createResult?: unknown
  deleteFiles?: jest.Mock
  graphResult?: unknown
} = {}) => {
  const fileService = {
    createFiles: jest.fn(
      async (_input: { content: string; filename: string; mimeType: string }) =>
        createResult
    ),
    deleteFiles,
    getAsBuffer: jest.fn(async () => content),
  }
  const locking = {
    execute: jest.fn(async (_key: string, operation: () => Promise<unknown>) =>
      operation()
    ),
  }
  const logger = {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  }
  const query = { graph: jest.fn(async () => graphResult) }
  const resolve = jest.fn((key: string) => {
    if (key === Modules.FILE) {
      return fileService
    }
    if (key === Modules.LOCKING) {
      return locking
    }
    if (key === ContainerRegistrationKeys.QUERY) {
      return query
    }
    if (key === "logger") {
      return logger
    }
    throw new Error(`Unexpected dependency: ${key}`)
  })
  const req = {
    body: {
      file_key: "file_upload_01",
      originalname: "../private/catalog.csv",
    },
    scope: { resolve },
  } as unknown as Parameters<typeof POST>[0]

  return { fileService, locking, logger, query, req }
}

describe("POST /admin/products/imports", () => {
  it("prepares and persists a bounded plan under a distributed lock", async () => {
    const fixture = requestFixture()
    const { res, state } = responseFixture()

    await POST(fixture.req, res)

    expect(fixture.locking.execute).toHaveBeenCalledWith(
      productImportLockKey("file_upload_01"),
      expect.any(Function),
      { timeout: 5 }
    )
    const createInput = fixture.fileService.createFiles.mock.calls[0]?.[0]
    expect(createInput).toEqual({
      content: expect.any(String),
      filename: "product-import-plan.json",
      mimeType: "application/json",
    })
    expect(JSON.parse(createInput?.content ?? "{}")).toEqual({
      create: [expect.objectContaining({ handle: "new-release" })],
      filename: "catalog.csv",
      generatedAt: expect.any(String),
      update: [],
    })
    expect(fixture.fileService.deleteFiles).toHaveBeenCalledWith(
      "file_upload_01"
    )
    expect(state).toEqual({
      body: {
        summary: {
          recoveredUpdates: 0,
          rows: 1,
          toCreate: 1,
          toUpdate: 0,
        },
        transaction_id: "file_plan_01",
      },
      status: 202,
    })
    const logs = JSON.stringify(fixture.logger.info.mock.calls)
    expect(logs).not.toContain("file_upload_01")
    expect(logs).not.toContain("catalog.csv")
  })

  it("rolls back a persisted plan when upload cleanup fails", async () => {
    const deleteFiles = jest.fn(async (id: string) => {
      if (id === "file_upload_01") {
        throw new Error("storage unavailable")
      }
    })
    const fixture = requestFixture({ deleteFiles })
    const { res } = responseFixture()

    await expect(POST(fixture.req, res)).rejects.toThrow("storage unavailable")
    expect(deleteFiles.mock.calls).toEqual([
      ["file_upload_01"],
      ["file_plan_01"],
    ])
    expect(fixture.logger.error).toHaveBeenCalledWith(
      "[admin][products/imports] import preparation failed."
    )
  })

  it("rejects malformed uploads and graph envelopes before persisting a plan", async () => {
    const malformedUpload = requestFixture({
      content: Buffer.from("Product Handle\u0000\nnew-release\n"),
    })
    const malformedGraph = requestFixture({ graphResult: { data: ["bad"] } })
    const firstResponse = responseFixture()
    const secondResponse = responseFixture()

    await expect(POST(malformedUpload.req, firstResponse.res)).rejects.toThrow(
      "The product import data is invalid."
    )
    await expect(POST(malformedGraph.req, secondResponse.res)).rejects.toThrow(
      "The product import data is invalid."
    )
    expect(malformedUpload.fileService.createFiles).not.toHaveBeenCalled()
    expect(malformedGraph.fileService.createFiles).not.toHaveBeenCalled()
    expect(malformedUpload.fileService.deleteFiles).not.toHaveBeenCalled()
    expect(malformedGraph.fileService.deleteFiles).not.toHaveBeenCalled()
  })

  it("does not delete the upload when file persistence returns an invalid ID", async () => {
    const fixture = requestFixture({
      createResult: { id: "../../plan.json", url: "memory://plan" },
    })
    const { res } = responseFixture()

    await expect(POST(fixture.req, res)).rejects.toThrow(
      "The product import data is invalid."
    )
    expect(fixture.fileService.deleteFiles).not.toHaveBeenCalled()
  })
})
