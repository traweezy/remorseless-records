import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"

import { loadCatalogProductMediaResponse } from "@/lib/catalog/product-media-authoring"
import { mutateCatalogProductMediaWorkflow } from "../../../../../../workflows/catalog/mutate-product-media"
import {
  assertProductExists,
  assertVariantBelongsToProduct,
} from "../../../utils"
import { PUT } from "./route"
import { hashCatalogCommand } from "@/modules/catalog/catalog-command"

jest.mock("@/lib/catalog/product-media-authoring", () => {
  const actual = jest.requireActual(
    "@/lib/catalog/product-media-authoring"
  ) as Record<string, unknown>
  return {
    ...actual,
    loadCatalogProductMediaResponse: jest.fn(),
  }
})
jest.mock("../../../../../../workflows/catalog/mutate-product-media", () => ({
  mutateCatalogProductMediaWorkflow: jest.fn(),
}))
jest.mock("../../../utils", () => ({
  assertProductExists: jest.fn(),
  assertVariantBelongsToProduct: jest.fn(),
}))

const loadResponseMock = loadCatalogProductMediaResponse as jest.MockedFunction<
  typeof loadCatalogProductMediaResponse
>
const workflowMock = mutateCatalogProductMediaWorkflow as jest.MockedFunction<
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
  it.each([
    { actor_id: "user_2", actor_type: "user", type: "conflict" },
    { actor_id: "user_1", actor_type: "customer", type: "unauthorized" },
    { actor_id: "user_1", actor_type: undefined, type: "unauthorized" },
    { actor_id: "customer_1", actor_type: "user", type: "unauthorized" },
  ])(
    "rejects a changed or non-user actor before any service access: %j",
    async ({ type, ...auth_context }) => {
      const req = requestFixture({
        expectedVersion: 0,
        expectedActorId: "user_1",
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
        media: [],
      })
      Object.assign(req, { auth_context })
      await expect(PUT(req, responseFixture().res)).rejects.toMatchObject({
        type,
      })
      expect(req.scope.resolve).not.toHaveBeenCalled()
      expect(assertProductExistsMock).not.toHaveBeenCalled()
      expect(assertVariantBelongsMock).not.toHaveBeenCalled()
      expect(workflowMock).not.toHaveBeenCalled()
      expect(loadResponseMock).not.toHaveBeenCalled()
    }
  )

  it.each([null, 4, "", "customer_1", `user_${"a".repeat(249)}`, {}])(
    "rejects an invalid optional actor precondition: %j",
    async (expectedActorId) => {
      const req = requestFixture({
        expectedVersion: 0,
        expectedActorId,
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
        media: [],
      })
      await expect(PUT(req, responseFixture().res)).rejects.toThrow(
        "Invalid catalog product media payload"
      )
      expect(req.scope.resolve).not.toHaveBeenCalled()
      expect(assertProductExistsMock).not.toHaveBeenCalled()
      expect(workflowMock).not.toHaveBeenCalled()
    }
  )

  it("checks the native user precondition without changing the legacy digest or workflow contract", async () => {
    const run = jest
      .fn()
      .mockResolvedValue({ result: { productId: "prod_1", version: 1 } })
    workflowMock.mockReturnValue({ run } as never)
    const body = {
      expectedVersion: 0,
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
      media: [],
    }
    const req = requestFixture({ ...body, expectedActorId: "user_1" })
    Object.assign(req, {
      auth_context: { actor_id: "user_1", actor_type: "user" },
    })
    await PUT(req, responseFixture().res)
    const input = run.mock.calls[0]![0].input
    expect(input.actorId).toBe("user_1")
    expect(input.requestSha256).toBe(
      hashCatalogCommand({
        command: "catalog.product-media.replace",
        expectedVersion: 0,
        media: [],
        productId: "prod_1",
      })
    )
    expect(input).not.toHaveProperty("expectedActorId")
    await PUT(requestFixture(body), responseFixture().res)
    expect(run.mock.calls[1]![0].input).toEqual(input)
  })

  it("returns the current gallery projection after an immutable operation replay", async () => {
    const run = jest.fn().mockResolvedValue({
      result: { productId: "prod_1", version: 1, replayed: true },
    })
    workflowMock.mockReturnValue({ run } as never)
    loadResponseMock.mockResolvedValue({
      media: [],
      productId: "prod_1",
      version: 4,
    })
    const req = requestFixture({
      expectedVersion: 0,
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
      media: [],
    })
    const { res, state } = responseFixture()
    await PUT(req, res)
    expect(state).toEqual({
      status: 200,
      body: { media: [], productId: "prod_1", version: 4 },
    })
  })

  it("never forwards claimed parent lease ownership from an HTTP payload", async () => {
    const run = jest
      .fn()
      .mockResolvedValue({ result: { productId: "prod_1", version: 1 } })
    workflowMock.mockReturnValue({ run } as never)
    const req = requestFixture({
      expectedVersion: 0,
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
      media: [],
      inheritedMediaLease: {
        keys: ["catalog:product-media:prod_1"],
        ownerId: "claimed-parent-owner",
      },
    })
    await PUT(req, responseFixture().res)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0]![0].input).not.toHaveProperty(
      "inheritedMediaLease"
    )
  })

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
      "variant_1"
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
      "Invalid catalog product media payload"
    )
    expect(assertProductExistsMock).not.toHaveBeenCalled()
    expect(workflowMock).not.toHaveBeenCalled()
  })
})
