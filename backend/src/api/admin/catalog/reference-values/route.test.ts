import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"

import { GET, POST } from "./route"

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

type ResponseState = { body: unknown; status: number }

const responseFixture = (): { res: MedusaResponse; state: ResponseState } => {
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

const requestFixture = (
  service: Record<string, unknown>,
  options: { body?: unknown; query?: Record<string, unknown> } = {}
): MedusaRequest =>
  ({
    body: options.body,
    query: options.query ?? {},
    scope: { resolve: jest.fn(() => service) },
  }) as unknown as MedusaRequest

describe("catalog reference collection routes", () => {
  it("returns a validated filtered page", async () => {
    const listAndCountCatalogReferenceValues = jest
      .fn()
      .mockResolvedValue([[referenceValue()], 1])
    const { res, state } = responseFixture()

    await GET(
      requestFixture(
        { listAndCountCatalogReferenceValues },
        { query: { active: "true", kind: "format" } }
      ),
      res
    )

    expect(listAndCountCatalogReferenceValues).toHaveBeenCalledWith(
      { is_active: true, kind: "format" },
      expect.objectContaining({ skip: 0, take: 100 })
    )
    expect(state).toEqual({
      body: {
        count: 1,
        limit: 100,
        offset: 0,
        values: [expect.objectContaining({ id: "cref_1", label: "Vinyl" })],
      },
      status: 200,
    })
  })

  it("rejects malformed counted pages before serialization", async () => {
    const req = requestFixture({
      listAndCountCatalogReferenceValues: jest
        .fn()
        .mockResolvedValue([[{ id: "wrong" }], 1]),
    })

    await expect(GET(req, {} as MedusaResponse)).rejects.toThrow(
      INVALID_PROFILE
    )
  })

  it("requires an exact create acknowledgement", async () => {
    const createCatalogReferenceValues = jest
      .fn()
      .mockResolvedValue([referenceValue({ rank: 10 })])
    const req = requestFixture(
      { createCatalogReferenceValues },
      { body: { kind: "format", label: "Vinyl", rank: 11 } }
    )

    await expect(POST(req, {} as MedusaResponse)).rejects.toThrow(
      INVALID_PROFILE
    )
  })

  it("rejects invalid ranks before persistence", async () => {
    const resolve = jest.fn()
    const req = {
      body: { kind: "format", label: "Vinyl", rank: -1 },
      scope: { resolve },
    } as unknown as MedusaRequest

    await expect(POST(req, {} as MedusaResponse)).rejects.toThrow(
      "Invalid catalog reference payload"
    )
    expect(resolve).not.toHaveBeenCalled()
  })
})
