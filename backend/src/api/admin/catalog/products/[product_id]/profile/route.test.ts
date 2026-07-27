import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"

import {
  resolveCatalogProductProfile,
  serializeCatalogProductProfileResponse,
} from "@/lib/catalog/product-profile-authoring"
import { mutateCatalogProductProfileWorkflow } from "../../../../../../workflows/catalog/mutate-product-profile"
import { assertProductExists } from "../../../utils"
import { PUT } from "./route"

jest.mock("@/lib/catalog/product-profile-authoring", () => {
  const actual = jest.requireActual(
    "@/lib/catalog/product-profile-authoring",
  ) as Record<string, unknown>
  return {
    ...actual,
    resolveCatalogProductProfile: jest.fn(),
    serializeCatalogProductProfileResponse: jest.fn(),
  }
})
jest.mock("../../../../../../workflows/catalog/mutate-product-profile", () => ({
  mutateCatalogProductProfileWorkflow: jest.fn(),
}))
jest.mock("../../../utils", () => ({
  assertProductExists: jest.fn(),
}))

const resolveProfileMock = resolveCatalogProductProfile as jest.MockedFunction<
  typeof resolveCatalogProductProfile
>
const serializeResponseMock =
  serializeCatalogProductProfileResponse as jest.MockedFunction<
    typeof serializeCatalogProductProfileResponse
  >
const workflowMock =
  mutateCatalogProductProfileWorkflow as jest.MockedFunction<
    typeof mutateCatalogProductProfileWorkflow
  >
const assertProductExistsMock = assertProductExists as jest.MockedFunction<
  typeof assertProductExists
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
  resolveProfileMock.mockResolvedValue({ id: "cprof_1" } as never)
  serializeResponseMock.mockResolvedValue({ profile: "serialized" } as never)
})

describe("PUT /admin/catalog/products/:product_id/profile", () => {
  it("runs the locked command with actor, idempotency, and expected version", async () => {
    const run = jest.fn().mockResolvedValue({
      result: { created: true, profileId: "cprof_1", version: 1 },
    })
    workflowMock.mockReturnValue({ run } as never)
    const req = requestFixture({
      expectedVersion: 0,
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
      releaseTitle: "Album",
    })
    const { res, state } = responseFixture()

    await PUT(req, res)

    expect(assertProductExistsMock).toHaveBeenCalledWith(req, "prod_1")
    expect(run).toHaveBeenCalledWith({
      context: {
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
        requestId: "00000000-0000-4000-8000-000000000001",
      },
      input: expect.objectContaining({
        actorId: "user_1",
        aggregateId: "prod_1",
        command: "catalog.product-profile.upsert",
        expectedVersion: 0,
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
        patch: { releaseTitle: "Album" },
        requestSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    })
    expect(state).toEqual({
      body: { profile: "serialized" },
      status: 201,
    })
  })

  it("rejects invalid input before resolving product or workflow state", async () => {
    const req = requestFixture({
      expectedVersion: -1,
      idempotencyKey: "not-a-uuid",
    })
    const { res } = responseFixture()

    await expect(PUT(req, res)).rejects.toThrow(
      "Invalid catalog product profile payload",
    )
    expect(assertProductExistsMock).not.toHaveBeenCalled()
    expect(workflowMock).not.toHaveBeenCalled()
  })
})
