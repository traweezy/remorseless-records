import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"

import { loadCatalogAuthoringAudit } from "../../../../lib/catalog/load-authoring-audit"

import { GET } from "./route"

jest.mock("../../../../lib/catalog/load-authoring-audit", () => ({
  loadCatalogAuthoringAudit: jest.fn(),
}))

const loadAuditMock = loadCatalogAuthoringAudit as jest.MockedFunction<
  typeof loadCatalogAuthoringAudit
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

const requestFixture = (query: Record<string, unknown> = {}): MedusaRequest =>
  ({
    query,
    scope: { resolve: jest.fn() },
  }) as unknown as MedusaRequest

const summary = {
  blockingItemCount: 1,
  byKind: {
    fixed_bundle: 0,
    merch: 1,
    music_release: 1,
    mystery_bundle: 0,
  },
  byStatus: {
    classified: 1,
    conflict: 0,
    needs_review: 1,
  },
  issueCounts: {
    invalid_authoring_kind: 1,
  },
  total: 2,
}

beforeEach(() => {
  jest.clearAllMocks()
  loadAuditMock.mockResolvedValue({
    items: [
      {
        handle: "release",
        id: "prod_release",
        issues: [],
        kind: "music_release",
        signals: [],
        status: "classified",
        title: "Release",
      },
      {
        handle: "shirt",
        id: "prod_merch",
        issues: [
          {
            code: "invalid_authoring_kind",
            message: "Invalid.",
            severity: "warning",
          },
        ],
        kind: "merch",
        signals: [],
        status: "needs_review",
        title: "Shirt",
      },
    ],
    summary,
  })
})

describe("GET /admin/catalog/authoring-audit", () => {
  it("returns the complete summary with private no-store caching", async () => {
    const { res, state } = responseFixture()

    await GET(requestFixture(), res)

    expect(loadAuditMock).toHaveBeenCalledTimes(1)
    expect(state).toMatchObject({
      body: {
        filteredCount: 2,
        items: expect.any(Array),
        limit: 100,
        offset: 0,
        summary,
      },
      headers: {
        "cache-control": "private, no-store",
      },
      status: 200,
    })
  })

  it("combines server-side kind, status, search, and pagination filters", async () => {
    const { res, state } = responseFixture()

    await GET(
      requestFixture({
        kind: "merch",
        limit: "1",
        offset: "0",
        q: "shirt",
        status: "needs_review",
      }),
      res
    )

    expect(state.body).toMatchObject({
      filteredCount: 1,
      items: [
        expect.objectContaining({
          id: "prod_merch",
        }),
      ],
      limit: 1,
      offset: 0,
      summary,
    })
  })

  it("rejects unsupported filters before loading catalog data", async () => {
    const { res } = responseFixture()

    await expect(
      GET(requestFixture({ kind: "box-set" }), res)
    ).rejects.toThrow()
    expect(loadAuditMock).not.toHaveBeenCalled()
  })
})
