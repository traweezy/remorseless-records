import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"

import { inspectCatalogProductCreation } from "@/lib/catalog/product-create-authoring"
import { GET } from "./route"

jest.mock("@/lib/catalog/product-create-authoring", () => ({
  inspectCatalogProductCreation: jest.fn(),
}))

const inspectMock = inspectCatalogProductCreation as jest.MockedFunction<
  typeof inspectCatalogProductCreation
>

const requestFixture = (idempotencyKey: string): MedusaRequest =>
  ({
    auth_context: { actor_id: "user_1" },
    params: { idempotency_key: idempotencyKey },
    scope: { resolve: jest.fn().mockReturnValue({}) },
  }) as unknown as MedusaRequest

const responseFixture = () => {
  const response = {} as MedusaResponse
  response.setHeader = jest.fn() as MedusaResponse["setHeader"]
  response.status = jest.fn().mockReturnValue(response) as MedusaResponse["status"]
  response.json = jest.fn().mockReturnValue(response) as MedusaResponse["json"]
  return response
}

beforeEach(() => jest.clearAllMocks())

describe("GET /admin/catalog/products/status/:idempotency_key", () => {
  it("returns a private actor-scoped, non-cacheable creation state", async () => {
    inspectMock.mockResolvedValue("compensated")
    const request = requestFixture(
      "00000000-0000-4000-8000-000000000001",
    )
    const response = responseFixture()

    await GET(request, response)

    expect(inspectMock).toHaveBeenCalledWith(
      expect.anything(),
      "user_1",
      "00000000-0000-4000-8000-000000000001",
    )
    expect(response.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "no-store",
    )
    expect(response.status).toHaveBeenCalledWith(200)
    expect(response.json).toHaveBeenCalledWith({ state: "compensated" })
  })

  it("rejects malformed keys before reading the ledger", async () => {
    await expect(
      GET(requestFixture("not-a-uuid"), responseFixture()),
    ).rejects.toThrow("Invalid catalog product creation idempotency key")
    expect(inspectMock).not.toHaveBeenCalled()
  })
})
