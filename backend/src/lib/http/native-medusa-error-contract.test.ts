import path from "node:path"

import type {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import middlewares from "../../api/middlewares"

type NativeErrorHandler = (
  error: unknown,
  req: MedusaRequest,
  res: MedusaResponse,
  next: jest.Mock,
) => void

type ResponseState = {
  body: Record<string, unknown> | undefined
  status: number
}

const nativeErrorHandler = (): NativeErrorHandler => {
  const frameworkEntry = require.resolve("@medusajs/framework")
  const errorHandlerPath = path.join(
    path.dirname(frameworkEntry),
    "http/middlewares/error-handler.js",
  )
  const module = jest.requireActual<{
    errorHandler: () => NativeErrorHandler
  }>(errorHandlerPath)
  return module.errorHandler()
}

const responseFixture = (): {
  req: MedusaRequest
  res: MedusaResponse
  state: ResponseState
} => {
  const state: ResponseState = { body: undefined, status: 200 }
  const logger = { error: jest.fn(), info: jest.fn() }
  const req = {
    path: "/admin/contract-test",
    scope: { resolve: jest.fn(() => logger) },
  } as unknown as MedusaRequest
  const response = {} as MedusaResponse
  response.status = jest.fn((status: number) => {
    state.status = status
    return response
  }) as MedusaResponse["status"]
  response.json = jest.fn((body: Record<string, unknown>) => {
    state.body = body
    return response
  }) as MedusaResponse["json"]
  return { req, res: response, state }
}

describe("native Medusa error compatibility", () => {
  it("does not replace Medusa's framework error handler", () => {
    expect(middlewares.errorHandler).toBeUndefined()
  })

  it.each([
    [MedusaError.Types.UNAUTHORIZED, 401],
    [MedusaError.Types.FORBIDDEN, 403],
    [MedusaError.Types.INVALID_DATA, 400],
  ])("keeps the %s Admin SDK envelope", (type, status) => {
    const { req, res, state } = responseFixture()

    nativeErrorHandler()(
      new MedusaError(type, "Safe native message"),
      req,
      res,
      jest.fn(),
    )

    expect(state.status).toBe(status)
    expect(state.body).toMatchObject({
      message: "Safe native message",
      type,
    })
    expect(state.body).not.toHaveProperty("request_id")
    expect(state.body).not.toHaveProperty("trace_id")
  })

  it("redacts unexpected native errors without changing the SDK envelope", () => {
    const { req, res, state } = responseFixture()

    nativeErrorHandler()(
      new Error("postgresql://operator:secret@database.internal/admin"),
      req,
      res,
      jest.fn(),
    )

    expect(state.status).toBe(500)
    expect(state.body).toEqual({
      code: "unknown_error",
      message: "An unknown error occurred.",
      type: "unknown_error",
    })
    expect(JSON.stringify(state.body)).not.toContain("operator:secret")
  })
})
