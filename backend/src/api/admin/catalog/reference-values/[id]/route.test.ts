import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"

import { GET, PUT } from "./route"

const INVALID_PROFILE =
  "The catalog profile persistence boundary returned invalid structured data."

const referenceValue = (overrides: Record<string, unknown> = {}) => ({
  created_at: "2026-08-01T00:00:00.000Z",
  description: null,
  id: "cref_1",
  is_active: true,
  kind: "format",
  label: "Vinyl",
  metadata: {},
  rank: 10,
  updated_at: "2026-08-02T00:00:00.000Z",
  value: "vinyl",
  ...overrides,
})

const requestFixture = (
  service: Record<string, unknown>,
  body: unknown = undefined
): MedusaRequest =>
  ({
    body,
    params: { id: "cref_1" },
    scope: { resolve: jest.fn(() => service) },
  }) as unknown as MedusaRequest

const responseFixture = (): MedusaResponse => {
  const response = {} as MedusaResponse
  response.status = jest.fn(() => response) as MedusaResponse["status"]
  response.json = jest.fn(() => response) as MedusaResponse["json"]
  return response
}

describe("catalog reference detail routes", () => {
  it("returns not found only for an absent record", async () => {
    const req = requestFixture({
      retrieveCatalogReferenceValue: jest.fn().mockResolvedValue(null),
    })

    await expect(GET(req, responseFixture())).rejects.toThrow(
      "Catalog reference value not found"
    )
  })

  it("rejects malformed records as persistence failures", async () => {
    const req = requestFixture({
      retrieveCatalogReferenceValue: jest.fn().mockResolvedValue(false),
    })

    await expect(GET(req, responseFixture())).rejects.toThrow(INVALID_PROFILE)
  })

  it("requires an exact update acknowledgement", async () => {
    const service = {
      retrieveCatalogReferenceValue: jest
        .fn()
        .mockResolvedValue(referenceValue()),
      updateCatalogReferenceValues: jest
        .fn()
        .mockResolvedValue([referenceValue()]),
    }
    const req = requestFixture(service, { rank: 11 })

    await expect(PUT(req, responseFixture())).rejects.toThrow(INVALID_PROFILE)
    expect(service.updateCatalogReferenceValues).toHaveBeenCalledWith([
      { id: "cref_1", rank: 11 },
    ])
  })
})
