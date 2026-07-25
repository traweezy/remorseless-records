import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const activeCartMocks = vi.hoisted(() => ({
  resolveCheckoutCartIdentity: vi.fn(),
}))
const guardMocks = vi.hoisted(() => ({
  guardCheckoutRead: vi.fn(),
}))
const statusMocks = vi.hoisted(() => {
  class CheckoutStatusUnavailableError extends Error {}
  return {
    CheckoutStatusUnavailableError,
    fetchInternalCheckoutStatus: vi.fn(),
  }
})
const receiptMocks = vi.hoisted(() => ({
  readReceiptGrant: vi.fn(),
}))
const responseMocks = vi.hoisted(() => ({
  checkoutStateResponse: vi.fn(),
}))
const cookieMocks = vi.hoisted(() => ({
  clearCartCookie: vi.fn(),
}))

vi.mock("next/cache", () => ({ unstable_noStore: vi.fn() }))
vi.mock(
  "@/features/checkout/server/active-cart",
  () => activeCartMocks
)
vi.mock("@/features/checkout/server/guards", () => guardMocks)
vi.mock(
  "@/features/checkout/server/internal-status-client",
  () => statusMocks
)
vi.mock(
  "@/features/checkout/server/receipt-grant",
  () => receiptMocks
)
vi.mock("@/features/checkout/server/responses", () => responseMocks)
vi.mock("@/lib/cart/cookie", () => cookieMocks)

import { GET } from "@/app/api/checkout/status/route"

const request = (): NextRequest =>
  new NextRequest("https://storefront.test/api/checkout/status", {
    headers: {
      host: "storefront.test",
      referer: "https://storefront.test/checkout",
      "sec-fetch-site": "same-origin",
      "x-forwarded-for": "192.0.2.56",
    },
  })

describe("GET /api/checkout/status", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    guardMocks.guardCheckoutRead.mockResolvedValue(null)
    receiptMocks.readReceiptGrant.mockReturnValue(null)
    activeCartMocks.resolveCheckoutCartIdentity.mockReturnValue({
      ok: true,
      value: { cartId: "cart_signed", needsCookieRotation: false },
    })
    responseMocks.checkoutStateResponse.mockImplementation((state: string) =>
      Response.json({ checkout: { state } })
    )
    cookieMocks.clearCartCookie.mockImplementation(
      (response: Response) => response
    )
  })

  it("trusts a valid receipt grant without exposing or re-querying identity", async () => {
    receiptMocks.readReceiptGrant.mockReturnValue({
      orderId: "order_01K123ABC",
      issuedAt: 1,
      expiresAt: 2,
    })

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(responseMocks.checkoutStateResponse).toHaveBeenCalledWith(
      "order_confirmed"
    )
    expect(
      activeCartMocks.resolveCheckoutCartIdentity
    ).not.toHaveBeenCalled()
    expect(statusMocks.fetchInternalCheckoutStatus).not.toHaveBeenCalled()
  })

  it("keeps an order-link state nonterminal until completion returns", async () => {
    statusMocks.fetchInternalCheckoutStatus.mockResolvedValue({
      state: "finalizing_order",
    })

    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      checkout: { state: "finalizing_order" },
    })
  })

  it.each([
    "cart_active",
    "finalizing_order",
    "payment_action_required",
    "payment_failed",
    "payment_processing",
  ] as const)("returns safe nonterminal state %s", async (state) => {
    statusMocks.fetchInternalCheckoutStatus.mockResolvedValue({
      state,
    })

    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      checkout: { state },
    })
  })

  it("clears stale cart identity only after an authoritative missing state", async () => {
    statusMocks.fetchInternalCheckoutStatus.mockResolvedValue({
      state: "cart_missing",
    })

    await GET(request())

    expect(cookieMocks.clearCartCookie).toHaveBeenCalledOnce()
  })

  it("returns a retryable problem when authoritative status is unavailable", async () => {
    statusMocks.fetchInternalCheckoutStatus.mockRejectedValue(
      new statusMocks.CheckoutStatusUnavailableError("offline")
    )

    const response = await GET(request())

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      code: "recovery_required",
    })
  })
})
