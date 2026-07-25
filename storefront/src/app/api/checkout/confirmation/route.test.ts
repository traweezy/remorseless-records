import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const guardMocks = vi.hoisted(() => ({
  guardCheckoutRead: vi.fn(),
}))
const receiptGrantMocks = vi.hoisted(() => ({
  readReceiptGrant: vi.fn(),
}))
const orderReceiptMocks = vi.hoisted(() => ({
  getOrderReceipt: vi.fn(),
}))

vi.mock("next/cache", () => ({ unstable_noStore: vi.fn() }))
vi.mock("@/features/checkout/server/guards", () => guardMocks)
vi.mock("@/features/checkout/server/receipt-grant", () => receiptGrantMocks)
vi.mock("@/features/checkout/server/order-receipt", () => orderReceiptMocks)

import { GET } from "@/app/api/checkout/confirmation/route"

const request = (): NextRequest =>
  new NextRequest("https://storefront.test/api/checkout/confirmation", {
    headers: {
      host: "storefront.test",
      referer: "https://storefront.test/checkout/confirmation",
      "sec-fetch-site": "same-origin",
      "x-forwarded-for": "192.0.2.57",
    },
  })

const receipt = {
  orderNumber: "1042",
  placedAt: "2026-07-25T16:00:00.000Z",
  email: "buyer@example.test",
  items: [
    {
      id: "ordli_test",
      title: "Test Release",
      variantTitle: "LP",
      thumbnail: null,
      quantity: 1,
      total: 24.99,
    },
  ],
  deliveryAddress: null,
  deliveryMethod: "Standard",
  totals: {
    currencyCode: "usd",
    subtotal: 19.99,
    discountTotal: 0,
    shippingTotal: 5,
    taxTotal: 0,
    total: 24.99,
  },
}

describe("GET /api/checkout/confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    guardMocks.guardCheckoutRead.mockResolvedValue(null)
    receiptGrantMocks.readReceiptGrant.mockReturnValue({
      orderId: "order_01K123ABC",
      issuedAt: 1,
      expiresAt: 2,
    })
    orderReceiptMocks.getOrderReceipt.mockResolvedValue(receipt)
  })

  it("returns a customer-safe receipt only for the signed grant", async () => {
    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(orderReceiptMocks.getOrderReceipt).toHaveBeenCalledWith(
      "order_01K123ABC"
    )
    const payload: unknown = await response.json()
    expect(payload).toEqual({ receipt })
    expect(JSON.stringify(payload)).not.toContain("order_01K123ABC")
    expect(response.headers.get("cache-control")).toContain("no-store")
  })

  it("does not query an order when the receipt grant is missing", async () => {
    receiptGrantMocks.readReceiptGrant.mockReturnValue(null)

    const response = await GET(request())

    expect(response.status).toBe(404)
    expect(orderReceiptMocks.getOrderReceipt).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      code: "receipt_missing",
    })
  })

  it("returns a retryable safe problem when receipt retrieval fails", async () => {
    orderReceiptMocks.getOrderReceipt.mockRejectedValue(
      new Error("upstream internal detail")
    )

    const response = await GET(request())

    expect(response.status).toBe(503)
    const payload: unknown = await response.json()
    expect(payload).toMatchObject({ code: "receipt_unavailable" })
    expect(JSON.stringify(payload)).not.toContain("upstream internal detail")
  })
})
