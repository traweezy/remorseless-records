import { requestAdminJson } from "../../lib/admin-request"
import {
  REFUND_OPERATIONS_QUERY_KEY,
  refundOperationsQueryOptions,
  refundOperationsSnapshotSchema,
} from "./query"

jest.mock("../../lib/admin-request", () => ({
  requestAdminJson: jest.fn(),
}))

const validSnapshot = {
  cases: [
    {
      caseId: "order_01:refund_01",
      currencyCode: "usd",
      displayId: 42,
      latestRefundAt: "2026-07-27T05:00:00.000Z",
      lastVerifiedAt: "2026-07-27T05:01:00.000Z",
      medusaRefundAmountMinor: 1_500,
      medusaRefundCount: 1,
      nextAction: "No action required.",
      orderId: "order_01",
      provider: "stripe_tax",
      reasonLabels: ["Pricing error"],
      status: "verified",
      stripeRefundAmountMinor: 1_500,
      stripeRefundCount: 1,
      stripeStatuses: ["succeeded"],
      taxStatus: "verified",
    },
  ],
  generatedAt: "2026-07-27T05:02:00.000Z",
  reasonConfiguration: {
    configured: true,
    count: 3,
  },
  source: {
    evidenceScanned: 1,
    ordersScanned: 5,
    truncated: false,
    windowDays: 365,
  },
  summary: {
    actionRequired: 0,
    amountsByCurrency: [
      {
        amountMinor: 1_500,
        currencyCode: "usd",
      },
    ],
    processing: 0,
    totalCases: 1,
    verified: 1,
  },
} as const

describe("refund operations query", () => {
  beforeEach(() => {
    jest.mocked(requestAdminJson).mockReset()
  })

  it("accepts the complete operations snapshot contract", () => {
    expect(refundOperationsSnapshotSchema.parse(validSnapshot)).toEqual(
      validSnapshot
    )
  })

  it("rejects invalid provider and count values", () => {
    expect(() =>
      refundOperationsSnapshotSchema.parse({
        ...validSnapshot,
        cases: [
          {
            ...validSnapshot.cases[0],
            provider: "stripe",
          },
        ],
        summary: {
          ...validSnapshot.summary,
          totalCases: -1,
        },
      })
    ).toThrow()
  })

  it("accepts an explicit tax-disabled refund contract", () => {
    expect(
      refundOperationsSnapshotSchema.parse({
        ...validSnapshot,
        cases: [
          {
            ...validSnapshot.cases[0],
            provider: "disabled",
            taxStatus: "not_collected",
          },
        ],
      }).cases[0]
    ).toMatchObject({
      provider: "disabled",
      taxStatus: "not_collected",
    })
  })

  it("uses the shared request boundary and forwards Query cancellation", async () => {
    jest.mocked(requestAdminJson).mockResolvedValue(validSnapshot)
    const options = refundOperationsQueryOptions()
    const controller = new AbortController()

    await expect(
      options.queryFn?.({
        meta: undefined,
        queryKey: REFUND_OPERATIONS_QUERY_KEY,
        signal: controller.signal,
      })
    ).resolves.toEqual(validSnapshot)

    expect(requestAdminJson).toHaveBeenCalledWith({
      path: "/admin/refund-operations",
      schema: refundOperationsSnapshotSchema,
      signal: controller.signal,
    })
    expect(options.retry).toBe(false)
    expect(options.staleTime).toBe(0)
  })
})
