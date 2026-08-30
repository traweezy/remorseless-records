import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"

import { serializeCatalogMediaAsset } from "@/modules/catalog/serializers"
import { GET } from "./route"

jest.mock("@/modules/catalog/serializers", () => {
  const actual = jest.requireActual("@/modules/catalog/serializers") as Record<
    string,
    unknown
  >
  return {
    ...actual,
    serializeCatalogMediaAsset: jest.fn((asset: unknown) => asset),
  }
})

const serializeMock = serializeCatalogMediaAsset as jest.MockedFunction<
  typeof serializeCatalogMediaAsset
>

const responseFixture = (): MedusaResponse => {
  const response = {} as MedusaResponse
  response.status = jest.fn(() => response) as MedusaResponse["status"]
  response.json = jest.fn(() => response) as MedusaResponse["json"]
  response.setHeader = jest.fn(() => response) as MedusaResponse["setHeader"]
  return response
}

const requestFixture = (
  query: Record<string, unknown>
): {
  req: MedusaRequest
  listOrphans: jest.Mock
} => {
  const listOrphans = jest.fn().mockResolvedValue({
    count: 3,
    rows: [{ id: "cmedia_1" }, { id: "cmedia_2" }],
  })
  return {
    listOrphans,
    req: {
      query,
      scope: {
        resolve: jest.fn(() => ({
          listOrphanCatalogMediaAssets: listOrphans,
        })),
      },
    } as unknown as MedusaRequest,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe("GET /admin/catalog/media/orphans", () => {
  it("returns exact paginated orphan state from the anti-join query", async () => {
    const { req, listOrphans } = requestFixture({
      lifecycleStatus: "quarantined",
      limit: "2",
      offset: "0",
    })
    const res = responseFixture()

    await GET(req, res)

    expect(listOrphans).toHaveBeenCalledWith({
      lifecycleStatus: "quarantined",
      limit: 2,
      offset: 0,
    })
    expect(serializeMock).toHaveBeenCalledTimes(2)
    expect(res.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "private, no-store"
    )
    expect(res.setHeader).toHaveBeenCalledWith(
      "Server-Timing",
      expect.stringMatching(/^catalog-media-orphans;dur=\d+$/)
    )
    expect(res.json).toHaveBeenCalledWith({
      assets: [{ id: "cmedia_1" }, { id: "cmedia_2" }],
      count: 3,
      hasMore: true,
      limit: 2,
      offset: 0,
    })
  })

  it("rejects invalid pagination instead of silently changing it", async () => {
    const { req, listOrphans } = requestFixture({ limit: "1000" })

    await expect(GET(req, responseFixture())).rejects.toThrow(
      "Invalid catalog media orphan query"
    )
    expect(listOrphans).not.toHaveBeenCalled()
  })
})
