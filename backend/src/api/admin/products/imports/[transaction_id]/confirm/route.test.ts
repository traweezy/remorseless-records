import { batchProductsWorkflow } from "@medusajs/core-flows"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"

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
  const response = {} as MedusaResponse
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
    execute: jest.fn(async (_key: string, operation: () => Promise<unknown>) =>
      operation()
    ),
  }
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
      throw new Error(`Unexpected dependency: ${key}`)
    }),
  }
  const req = {
    params: { transaction_id: transactionId },
    scope,
  } as unknown as MedusaRequest

  return { fileService, locking, logger, req, run, scope }
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
})
