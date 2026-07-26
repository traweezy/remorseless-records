import type { HttpTypes } from "@medusajs/types"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const activeCartMocks = vi.hoisted(() => ({
  resolveCheckoutCartIdentity: vi.fn(),
}))
const guardMocks = vi.hoisted(() => ({
  guardCheckoutMutation: vi.fn(),
}))
const statusMocks = vi.hoisted(() => {
  class CheckoutStatusUnavailableError extends Error {}
  return {
    CheckoutStatusUnavailableError,
    fetchInternalCheckoutStatus: vi.fn(),
  }
})
const paymentMocks = vi.hoisted(() => {
  class CheckoutPaymentError extends Error {
    readonly code:
      | "payment_not_configured"
      | "payment_result_unknown"
      | "payment_session_stale"

    constructor(code: CheckoutPaymentError["code"]) {
      super(code)
      this.code = code
    }
  }
  return {
    CheckoutPaymentError,
    assertCompletablePayment: vi.fn(),
  }
})
const projectionMocks = vi.hoisted(() => ({
  createCheckoutProjection: vi.fn(),
}))
const revalidationMocks = vi.hoisted(() => {
  class CheckoutRevalidationError extends Error {
    readonly code = "shipping_changed"
  }
  return {
    CheckoutRevalidationError,
    revalidateShippingAndTaxes: vi.fn(),
  }
})
const responseMocks = vi.hoisted(() => ({
  orderConfirmedResponse: vi.fn(),
}))
const cartApiMocks = vi.hoisted(() => ({
  completeCart: vi.fn(),
  getCart: vi.fn(),
}))
const taxLinkMocks = vi.hoisted(() => {
  class CheckoutTaxLinkError extends Error {}
  return {
    CheckoutTaxLinkError,
    linkCheckoutTax: vi.fn(),
  }
})

vi.mock("next/cache", () => ({ unstable_noStore: vi.fn() }))
vi.mock("@/features/checkout/server/active-cart", () => activeCartMocks)
vi.mock("@/features/checkout/server/guards", () => guardMocks)
vi.mock("@/features/checkout/server/internal-status-client", () => statusMocks)
vi.mock("@/features/checkout/server/payment", () => paymentMocks)
vi.mock("@/features/checkout/server/projection", () => projectionMocks)
vi.mock("@/features/checkout/server/revalidate", () => revalidationMocks)
vi.mock("@/features/checkout/server/responses", () => responseMocks)
vi.mock("@/features/checkout/server/tax-link-client", () => taxLinkMocks)
vi.mock("@/lib/cart/api", () => cartApiMocks)

import { POST } from "@/app/api/checkout/complete/route"

const revision = `v1.${"a".repeat(43)}`
const changedRevision = `v1.${"b".repeat(43)}`

const cartFixture = (
  overrides: Partial<HttpTypes.StoreCart> = {}
): HttpTypes.StoreCart =>
  ({
    id: "cart_signed",
    currency_code: "usd",
    total: 24.99,
    items: [{ id: "cali_test", quantity: 1 }],
    shipping_methods: [{ shipping_option_id: "so_standard" }],
    ...overrides,
  }) as HttpTypes.StoreCart

const projection = (nextRevision = revision, total = 24.99) => ({
  revision: nextRevision,
  cart: { totals: { total } },
})

const request = (body: unknown = { revision }): NextRequest =>
  new NextRequest("https://storefront.test/api/checkout/complete", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "storefront.test",
      origin: "https://storefront.test",
      referer: "https://storefront.test/checkout",
      "sec-fetch-site": "same-origin",
      "x-forwarded-for": "192.0.2.55",
    },
    body: JSON.stringify(body),
  })

describe("POST /api/checkout/complete", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const cart = cartFixture()
    guardMocks.guardCheckoutMutation.mockResolvedValue(null)
    activeCartMocks.resolveCheckoutCartIdentity.mockReturnValue({
      ok: true,
      value: { cartId: "cart_signed", needsCookieRotation: false },
    })
    cartApiMocks.getCart.mockResolvedValue(cart)
    revalidationMocks.revalidateShippingAndTaxes.mockResolvedValue(cart)
    projectionMocks.createCheckoutProjection.mockReturnValue(projection())
    paymentMocks.assertCompletablePayment.mockReturnValue({
      status: "pending",
    })
    cartApiMocks.completeCart.mockResolvedValue({
      type: "order",
      order: { id: "order_01K123ABC", display_id: 1042 },
    })
    responseMocks.orderConfirmedResponse.mockReturnValue(
      Response.json({ checkout: { state: "order_confirmed" } })
    )
  })

  it("revalidates the revision, shipping, tax, and payment before completion", async () => {
    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(revalidationMocks.revalidateShippingAndTaxes).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cart_signed" })
    )
    expect(paymentMocks.assertCompletablePayment).toHaveBeenCalledOnce()
    expect(taxLinkMocks.linkCheckoutTax).toHaveBeenCalledWith("cart_signed")
    expect(cartApiMocks.completeCart).toHaveBeenCalledWith("cart_signed")
    expect(responseMocks.orderConfirmedResponse).toHaveBeenCalledWith({
      orderId: "order_01K123ABC",
      orderNumber: "1042",
    })
  })

  it("rejects a stale revision before any completion side effect", async () => {
    projectionMocks.createCheckoutProjection.mockReturnValue(
      projection(changedRevision)
    )

    const response = await POST(request())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      code: "checkout_changed",
      checkout: { revision: changedRevision },
    })
    expect(revalidationMocks.revalidateShippingAndTaxes).not.toHaveBeenCalled()
    expect(cartApiMocks.completeCart).not.toHaveBeenCalled()
  })

  it("requires review if the revalidated total changes", async () => {
    projectionMocks.createCheckoutProjection
      .mockReturnValueOnce(projection())
      .mockReturnValueOnce(projection(changedRevision, 25.99))

    const response = await POST(request())

    expect(response.status).toBe(409)
    expect(cartApiMocks.completeCart).not.toHaveBeenCalled()
  })

  it("completes a zero-dollar order without creating Stripe work", async () => {
    const zeroCart = cartFixture({ total: 0 })
    cartApiMocks.getCart.mockResolvedValue(zeroCart)
    revalidationMocks.revalidateShippingAndTaxes.mockResolvedValue(zeroCart)
    projectionMocks.createCheckoutProjection.mockReturnValue(
      projection(revision, 0)
    )

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(paymentMocks.assertCompletablePayment).not.toHaveBeenCalled()
    expect(taxLinkMocks.linkCheckoutTax).not.toHaveBeenCalled()
    expect(cartApiMocks.completeCart).toHaveBeenCalledOnce()
  })

  it.each([
    ["payment_requires_more_error", 409, "payment_action_required"],
    ["payment_authorization_error", 402, "payment_declined"],
  ])("maps Medusa %s without retrying", async (type, status, code) => {
    cartApiMocks.completeCart.mockResolvedValue({
      type: "cart",
      cart: cartFixture(),
      error: { type, name: "MedusaError", message: "internal detail" },
    })

    const response = await POST(request())

    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toMatchObject({ code })
    expect(statusMocks.fetchInternalCheckoutStatus).not.toHaveBeenCalled()
    expect(cartApiMocks.completeCart).toHaveBeenCalledOnce()
  })

  it("does not claim confirmation while a lost completion is finalizing", async () => {
    cartApiMocks.completeCart.mockRejectedValue(
      new DOMException("Timed out", "TimeoutError")
    )
    statusMocks.fetchInternalCheckoutStatus.mockResolvedValue({
      state: "finalizing_order",
    })

    const response = await POST(request())

    expect(response.status).toBe(409)
    expect(cartApiMocks.completeCart).toHaveBeenCalledOnce()
    expect(statusMocks.fetchInternalCheckoutStatus).toHaveBeenCalledWith(
      "cart_signed"
    )
    expect(responseMocks.orderConfirmedResponse).not.toHaveBeenCalled()
  })

  it("recovers a lost response after Medusa authoritatively completes", async () => {
    cartApiMocks.completeCart.mockRejectedValue(
      new DOMException("Timed out", "TimeoutError")
    )
    statusMocks.fetchInternalCheckoutStatus.mockResolvedValue({
      state: "order_confirmed",
      orderId: "order_01K123ABC",
    })

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(responseMocks.orderConfirmedResponse).toHaveBeenCalledWith({
      orderId: "order_01K123ABC",
    })
  })

  it("does not resubmit while an uncertain completion is still running", async () => {
    cartApiMocks.completeCart.mockRejectedValue(new Error("connection reset"))
    statusMocks.fetchInternalCheckoutStatus.mockResolvedValue({
      state: "finalizing_order",
    })

    const response = await POST(request())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      code: "completion_in_progress",
    })
    expect(cartApiMocks.completeCart).toHaveBeenCalledOnce()
  })

  it("uses Medusa's idempotent completion retry for a completed cart", async () => {
    cartApiMocks.getCart.mockResolvedValue(
      cartFixture({ completed_at: "2026-07-25T12:00:00.000Z" })
    )
    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(cartApiMocks.completeCart).toHaveBeenCalledWith("cart_signed")
    expect(statusMocks.fetchInternalCheckoutStatus).not.toHaveBeenCalled()
  })

  it("fails safely when an uncertain result cannot be recovered", async () => {
    cartApiMocks.completeCart.mockRejectedValue(new Error("connection reset"))
    statusMocks.fetchInternalCheckoutStatus.mockRejectedValue(
      new statusMocks.CheckoutStatusUnavailableError("offline")
    )

    const response = await POST(request())

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      code: "recovery_required",
    })
  })

  it("rejects caller-supplied cart identity", async () => {
    const response = await POST(request({ revision, cart_id: "cart_attacker" }))

    expect(response.status).toBe(400)
    expect(cartApiMocks.getCart).not.toHaveBeenCalled()
  })
})
