import { requestAdminJson } from "../../lib/admin-request"
import {
  catalogAuthoringAuditPayloadSchema,
  catalogAuthoringAuditQueryOptions,
} from "./catalog-authoring-audit-query"

jest.mock("../../lib/admin-request", () => ({
  requestAdminJson: jest.fn(),
}))

const catalogAuthoringAuditPayloadFixture = {
  filteredCount: 462,
  generatedAt: "2026-08-30T12:00:00.000Z",
  items: [
    {
      handle: "test-release",
      id: "prod_01",
      issues: [],
      kind: "music_release",
      signals: [
        {
          kind: "music_release",
          source: "catalog_product_type",
          value: "Music release",
        },
      ],
      status: "classified",
      title: "Test Release",
    },
  ],
  limit: 1,
  offset: 0,
  summary: {
    blockingItemCount: 0,
    byKind: {
      fixed_bundle: 14,
      merch: 5,
      music_release: 442,
      mystery_bundle: 1,
    },
    byStatus: {
      classified: 462,
      conflict: 0,
      needs_review: 0,
    },
    issueCounts: { native_product_type_missing: 462 },
    total: 462,
  },
} as const

describe("catalog authoring audit query boundary", () => {
  beforeEach(() => {
    jest.mocked(requestAdminJson).mockReset()
  })

  it("accepts the catalog health summary", () => {
    expect(
      catalogAuthoringAuditPayloadSchema.parse(
        catalogAuthoringAuditPayloadFixture,
      ),
    ).toEqual(catalogAuthoringAuditPayloadFixture)
  })

  it("rejects negative counts and unsupported kinds", () => {
    expect(() =>
      catalogAuthoringAuditPayloadSchema.parse({
        ...catalogAuthoringAuditPayloadFixture,
        summary: {
          ...catalogAuthoringAuditPayloadFixture.summary,
          total: -1,
        },
      }),
    ).toThrow()
    expect(() =>
      catalogAuthoringAuditPayloadSchema.parse({
        ...catalogAuthoringAuditPayloadFixture,
        items: [
          {
            ...catalogAuthoringAuditPayloadFixture.items[0],
            kind: "deal",
          },
        ],
      }),
    ).toThrow()
  })

  it("uses the summary endpoint and forwards query cancellation", async () => {
    jest
      .mocked(requestAdminJson)
      .mockResolvedValue(catalogAuthoringAuditPayloadFixture)
    const options = catalogAuthoringAuditQueryOptions()
    const controller = new AbortController()

    await expect(
      options.queryFn?.({
        meta: undefined,
        queryKey: options.queryKey,
        signal: controller.signal,
      }),
    ).resolves.toEqual(catalogAuthoringAuditPayloadFixture)

    expect(requestAdminJson).toHaveBeenCalledWith({
      path: "/admin/catalog/authoring-audit?limit=1",
      schema: catalogAuthoringAuditPayloadSchema,
      signal: controller.signal,
    })
    expect(options.refetchOnWindowFocus).toBe(false)
    expect(options.retry).toBe(false)
    expect(options.staleTime).toBe(60_000)
  })
})
