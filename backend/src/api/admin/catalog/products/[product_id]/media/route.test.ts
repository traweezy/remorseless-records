import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"

import { loadCatalogProductMediaResponse } from "@/lib/catalog/product-media-authoring"
import { mutateCatalogProductMediaWorkflow } from "@/workflows/catalog/mutate-product-media"
import {
  assertProductExists,
  assertVariantBelongsToProduct,
} from "../../../utils"
import { PUT } from "./route"

jest.mock("@/lib/catalog/product-media-authoring", () => {
  const actual = jest.requireActual(
    "@/lib/catalog/product-media-authoring",
  ) as Record<string, unknown>
  return {
    ...actual,
    loadCatalogProductMediaResponse: jest.fn(),
  }
})
jest.mock("@/workflows/catalog/mutate-product-media", () => ({
  mutateCatalogProductMediaWorkflow: jest.fn(),
}))
jest.mock("../../../utils", () => ({
  assertProductExists: jest.fn(),
  assertVariantBelongsToProduct: jest.fn(),
}))

const loadResponseMock =
  loadCatalogProductMediaResponse as jest.MockedFunction<
    typeof loadCatalogProductMediaResponse
  >
const workflowMock =
  mutateCatalogProductMediaWorkflow as jest.MockedFunction<
    typeof mutateCatalogProductMediaWorkflow
  >
const assertProductExistsMock = assertProductExists as jest.MockedFunction<
  typeof assertProductExists
>
const assertVariantBelongsMock =
  assertVariantBelongsToProduct as jest.MockedFunction<
    typeof assertVariantBelongsToProduct
  >

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

const requestFixture = (body: unknown): MedusaRequest =>
  ({
    auth_context: { actor_id: "user_1" },
    body,
    params: { product_id: "prod_1" },
    scope: {
      resolve: jest.fn(() => ({ service: true })),
    },
  }) as unknown as MedusaRequest

beforeEach(() => {
  jest.clearAllMocks()
  assertProductExistsMock.mockResolvedValue()
  assertVariantBelongsMock.mockResolvedValue()
  loadResponseMock.mockResolvedValue({
    media: [],
    productId: "prod_1",
    version: 1,
  })
})

describe("PUT /admin/catalog/products/:product_id/media", () => {
  it("validates variants and runs the locked command contract", async () => {
    const run = jest.fn().mockResolvedValue({
      result: { productId: "prod_1", version: 1 },
    })
    workflowMock.mockReturnValue({ run } as never)
    const req = requestFixture({
      expectedVersion: 0,
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
      media: [
        {
          sourceUrl: "https://media.example/cover.jpg",
          variantId: "variant_1",
        },
      ],
    })
    const { res, state } = responseFixture()

    await PUT(req, res)

    expect(assertProductExistsMock).toHaveBeenCalledWith(req, "prod_1")
    expect(assertVariantBelongsMock).toHaveBeenCalledWith(
      req,
      "prod_1",
      "variant_1",
    )
    expect(run).toHaveBeenCalledWith({
      context: {
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
        requestId: "00000000-0000-4000-8000-000000000001",
      },
      input: expect.objectContaining({
        actorId: "user_1",
        aggregateId: "prod_1",
        command: "catalog.product-media.replace",
        expectedVersion: 0,
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
        media: [
          {
            sourceUrl: "https://media.example/cover.jpg",
            variantId: "variant_1",
          },
        ],
        requestSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    })
    expect(state).toEqual({
      body: { media: [], productId: "prod_1", version: 1 },
      status: 200,
    })
  })

  it("rejects invalid input before product or workflow resolution", async () => {
    const req = requestFixture({
      expectedVersion: -1,
      idempotencyKey: "not-a-uuid",
      media: [],
    })
    const { res } = responseFixture()

    await expect(PUT(req, res)).rejects.toThrow(
      "Invalid catalog product media payload",
    )
    expect(assertProductExistsMock).not.toHaveBeenCalled()
    expect(workflowMock).not.toHaveBeenCalled()
  })
})
