import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"

import {
  resolveCatalogVariantProfile,
  serializeCatalogVariantProfileResponse,
} from "@/lib/catalog/variant-profile-authoring"
import { mutateCatalogVariantProfileWorkflow } from "../../../../../../workflows/catalog/mutate-variant-profile"
import { assertVariantExists } from "../../../utils"
import { PUT } from "./route"

jest.mock("@/lib/catalog/variant-profile-authoring", () => {
  const actual = jest.requireActual(
    "@/lib/catalog/variant-profile-authoring"
  ) as Record<string, unknown>
  return {
    ...actual,
    resolveCatalogVariantProfile: jest.fn(),
    serializeCatalogVariantProfileResponse: jest.fn(),
  }
})
jest.mock("../../../../../../workflows/catalog/mutate-variant-profile", () => ({
  mutateCatalogVariantProfileWorkflow: jest.fn(),
}))
jest.mock("../../../utils", () => ({
  assertVariantExists: jest.fn(),
}))

const resolveProfileMock = resolveCatalogVariantProfile as jest.MockedFunction<
  typeof resolveCatalogVariantProfile
>
const serializeResponseMock =
  serializeCatalogVariantProfileResponse as jest.MockedFunction<
    typeof serializeCatalogVariantProfileResponse
  >
const workflowMock = mutateCatalogVariantProfileWorkflow as jest.MockedFunction<
  typeof mutateCatalogVariantProfileWorkflow
>
const assertVariantExistsMock = assertVariantExists as jest.MockedFunction<
  typeof assertVariantExists
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
    params: { variant_id: "variant_1" },
    scope: {
      resolve: jest.fn(() => ({ service: true })),
    },
  }) as unknown as MedusaRequest

beforeEach(() => {
  jest.clearAllMocks()
  assertVariantExistsMock.mockResolvedValue()
  resolveProfileMock.mockResolvedValue({ id: "cvprof_1" } as never)
  serializeResponseMock.mockReturnValue({ profile: "serialized" } as never)
})

describe("PUT /admin/catalog/variants/:variant_id/profile", () => {
  it("runs the locked command with actor, idempotency, and expected version", async () => {
    const run = jest.fn().mockResolvedValue({
      result: { created: true, profileId: "cvprof_1", version: 1 },
    })
    workflowMock.mockReturnValue({ run } as never)
    const req = requestFixture({
      displayLabel: "LP",
      expectedVersion: 0,
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
    })
    const { res, state } = responseFixture()

    await PUT(req, res)

    expect(assertVariantExistsMock).toHaveBeenCalledWith(req, "variant_1")
    expect(run).toHaveBeenCalledWith({
      context: {
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
        requestId: "00000000-0000-4000-8000-000000000001",
      },
      input: expect.objectContaining({
        actorId: "user_1",
        aggregateId: "variant_1",
        command: "catalog.variant-profile.upsert",
        expectedVersion: 0,
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
        patch: { displayLabel: "LP" },
        requestSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    })
    expect(state).toEqual({
      body: { profile: "serialized" },
      status: 201,
    })
  })

  it("rejects invalid input before resolving variant or workflow state", async () => {
    const req = requestFixture({
      expectedVersion: -1,
      idempotencyKey: "not-a-uuid",
    })
    const { res } = responseFixture()

    await expect(PUT(req, res)).rejects.toThrow(
      "Invalid catalog variant profile payload"
    )
    expect(assertVariantExistsMock).not.toHaveBeenCalled()
    expect(workflowMock).not.toHaveBeenCalled()
  })
})
