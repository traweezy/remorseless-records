import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"

import { createCatalogProductWorkflow } from "../../../../workflows/catalog/create-product"
import { POST } from "./route"

jest.mock("../../../../workflows/catalog/create-product", () => ({
  createCatalogProductWorkflow: jest.fn(),
}))

const workflowMock = createCatalogProductWorkflow as jest.MockedFunction<
  typeof createCatalogProductWorkflow
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

const requestBody = {
  idempotencyKey: "00000000-0000-4000-8000-000000000001",
  kind: "music_release",
  title: "A New Record",
  options: [{ title: "Format", values: ["CD"] }],
  variants: [
    {
      key: "cd",
      title: "CD",
      options: { Format: "CD" },
      prices: [{ amount: 12, currencyCode: "usd" }],
      sku: "RECORD-CD",
      stockQuantity: 4,
      profile: { format: { label: "CD" } },
    },
  ],
  profile: { artists: [{ name: "The Artist", role: "primary" }] },
}

const requestFixture = (body: unknown): MedusaRequest =>
  ({
    auth_context: { actor_id: "user_1" },
    body,
    scope: { resolve: jest.fn() },
  }) as unknown as MedusaRequest

beforeEach(() => {
  jest.clearAllMocks()
})

describe("POST /admin/catalog/products", () => {
  it("runs one actor-bound creation command and returns its identifiers", async () => {
    const run = jest.fn().mockResolvedValue({
      result: {
        kind: "music_release",
        productId: "product_1",
        profileId: "profile_1",
        replayed: false,
        variantIds: ["variant_1"],
      },
    })
    workflowMock.mockReturnValue({ run } as never)
    const { res, state } = responseFixture()

    await POST(requestFixture(requestBody), res)

    expect(run).toHaveBeenCalledWith({
      context: {
        idempotencyKey: requestBody.idempotencyKey,
        requestId: requestBody.idempotencyKey,
      },
      input: expect.objectContaining({
        actorId: "user_1",
        idempotencyKey: requestBody.idempotencyKey,
        kind: "music_release",
        requestSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        title: "A New Record",
      }),
    })
    expect(state).toEqual({
      body: {
        kind: "music_release",
        productId: "product_1",
        profileId: "profile_1",
        replayed: false,
        variantIds: ["variant_1"],
      },
      status: 201,
    })
  })

  it("returns the stored result without claiming a second creation", async () => {
    const run = jest.fn().mockResolvedValue({
      result: {
        kind: "music_release",
        productId: "product_1",
        profileId: "profile_1",
        replayed: true,
        variantIds: ["variant_1"],
      },
    })
    workflowMock.mockReturnValue({ run } as never)
    const { res, state } = responseFixture()

    await POST(requestFixture(requestBody), res)

    expect(state.status).toBe(200)
    expect(state.body).toMatchObject({ productId: "product_1", replayed: true })
  })

  it("rejects invalid kind-specific input before starting a workflow", async () => {
    const { res } = responseFixture()

    await expect(
      POST(
        requestFixture({
          ...requestBody,
          profile: { artists: [] },
        }),
        res,
      ),
    ).rejects.toThrow("Invalid catalog product creation payload")
    expect(workflowMock).not.toHaveBeenCalled()
  })
})
