import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"

import { loadProductAuthoringView } from "../../../../../../lib/catalog/product-authoring-view"

import { GET } from "./route"

jest.mock("../../../../../../lib/catalog/product-authoring-view", () => ({
  loadProductAuthoringView: jest.fn(),
}))

const loadViewMock = loadProductAuthoringView as jest.MockedFunction<
  typeof loadProductAuthoringView
>

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

const requestFixture = (productId: string | undefined): MedusaRequest =>
  ({
    params: { product_id: productId },
    scope: { resolve: jest.fn() },
  }) as unknown as MedusaRequest

beforeEach(() => {
  jest.clearAllMocks()
  loadViewMock.mockResolvedValue({ product: true } as never)
})

describe("GET /admin/catalog/products/:product_id/authoring-view", () => {
  it("returns the consolidated view with private no-store caching", async () => {
    const req = requestFixture("prod_1")
    const { res, state } = responseFixture()

    await GET(req, res)

    expect(loadViewMock).toHaveBeenCalledWith(req.scope, "prod_1")
    expect(state).toEqual({
      body: { view: { product: true } },
      headers: { "cache-control": "private, no-store" },
      status: 200,
    })
  })

  it("rejects a missing product id before resolving services", async () => {
    const { res } = responseFixture()

    await expect(GET(requestFixture(undefined), res)).rejects.toThrow(
      "Product id is required"
    )
    expect(loadViewMock).not.toHaveBeenCalled()
  })
})
