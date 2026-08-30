import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { serializeCatalogMediaAsset } from "@/modules/catalog/serializers"
import { mutateCatalogMediaLifecycleWorkflow } from "../../../../../workflows/catalog/mutate-media-lifecycle"
import { runMediaLifecycleRoute } from "./lifecycle-route"

jest.mock("@/modules/catalog/serializers", () => {
  const actual = jest.requireActual("@/modules/catalog/serializers") as Record<
    string,
    unknown
  >
  return {
    ...actual,
    serializeCatalogMediaAsset: jest.fn(),
  }
})
jest.mock("../../../../../workflows/catalog/mutate-media-lifecycle", () => ({
  mutateCatalogMediaLifecycleWorkflow: jest.fn(),
}))

const serializeMock = serializeCatalogMediaAsset as jest.MockedFunction<
  typeof serializeCatalogMediaAsset
>
const workflowMock = mutateCatalogMediaLifecycleWorkflow as jest.MockedFunction<
  typeof mutateCatalogMediaLifecycleWorkflow
>

const responseFixture = (): MedusaResponse => {
  const response = {} as MedusaResponse
  response.status = jest.fn(() => response) as MedusaResponse["status"]
  response.json = jest.fn(() => response) as MedusaResponse["json"]
  response.setHeader = jest.fn(() => response) as MedusaResponse["setHeader"]
  return response
}

const requestFixture = (
  body: unknown,
  actorId: string | null = "user_1"
): AuthenticatedMedusaRequest => {
  const catalogService = {
    retrieveCatalogMediaAsset: jest.fn().mockResolvedValue({
      id: "cmedia_1",
    }),
  }
  return {
    auth_context: { actor_id: actorId },
    body,
    params: { id: "cmedia_1" },
    scope: {
      resolve: jest.fn(() => catalogService),
    },
  } as unknown as AuthenticatedMedusaRequest
}

beforeEach(() => {
  jest.clearAllMocks()
  serializeMock.mockReturnValue({ id: "cmedia_1" } as never)
})

describe("catalog media lifecycle routes", () => {
  it("runs a versioned, idempotent quarantine command", async () => {
    const run = jest.fn().mockResolvedValue({ result: {} })
    workflowMock.mockReturnValue({ run } as never)
    const idempotencyKey = "00000000-0000-4000-8000-000000000001"
    const req = requestFixture({
      expectedVersion: 1,
      idempotencyKey,
    })
    const res = responseFixture()

    await runMediaLifecycleRoute(req, res, "catalog.media.quarantine")

    expect(run).toHaveBeenCalledWith({
      context: {
        idempotencyKey,
        requestId: idempotencyKey,
      },
      input: {
        actorId: "user_1",
        assetId: "cmedia_1",
        command: "catalog.media.quarantine",
        expectedVersion: 1,
        idempotencyKey,
        requestSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    })
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "private, no-store"
    )
    expect(res.json).toHaveBeenCalledWith({
      asset: { id: "cmedia_1" },
    })
  })

  it("rejects invalid input or a missing authenticated actor", async () => {
    await expect(
      runMediaLifecycleRoute(
        requestFixture({
          expectedVersion: 0,
          idempotencyKey: "invalid",
        }),
        responseFixture(),
        "catalog.media.quarantine"
      )
    ).rejects.toThrow("valid catalog media lifecycle command")
    expect(workflowMock).not.toHaveBeenCalled()

    await expect(
      runMediaLifecycleRoute(
        requestFixture(
          {
            expectedVersion: 1,
            idempotencyKey: "00000000-0000-4000-8000-000000000001",
          },
          null
        ),
        responseFixture(),
        "catalog.media.restore"
      )
    ).rejects.toThrow("authenticated Admin actor")
  })
})
