import type { HttpTypes } from "@medusajs/types"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const activeCartMocks = vi.hoisted(() => ({
  checkoutProjectionResponse: vi.fn(),
  resolveActiveCheckoutCart: vi.fn(),
}))
const guardMocks = vi.hoisted(() => ({
  guardCheckoutMutation: vi.fn(),
}))
const paymentMocks = vi.hoisted(() => ({
  assertPreparedPayment: vi.fn(),
  paymentNeedsFinalization: vi.fn(),
  reusablePreparedPayment: vi.fn(),
}))
const projectionMocks = vi.hoisted(() => ({
  createCheckoutProjection: vi.fn(),
}))
const cartApiMocks = vi.hoisted(() => ({
  addShippingMethod: vi.fn(),
  calculateTaxes: vi.fn(),
  getCart: vi.fn(),
  initiatePaymentSession: vi.fn(),
  listShippingOptions: vi.fn(),
}))

vi.mock("next/cache", () => ({ unstable_noStore: vi.fn() }))
vi.mock(
  "@/features/checkout/server/active-cart",
  () => activeCartMocks
)
vi.mock("@/features/checkout/server/guards", () => guardMocks)
vi.mock("@/features/checkout/server/payment", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/features/checkout/server/payment")
  >()),
  ...paymentMocks,
}))
vi.mock(
  "@/features/checkout/server/projection",
  () => projectionMocks
)
vi.mock("@/lib/cart/api", () => cartApiMocks)

import { POST } from "@/app/api/checkout/payment-session/route"

const revision = `v1.${"a".repeat(43)}`
const changedRevision = `v1.${"b".repeat(43)}`
const cart = {
  id: "cart_signed",
  currency_code: "usd",
  total: 24.99,
  items: [{ id: "cali_test", quantity: 1 }],
  shipping_methods: [
    {
      id: "casm_test",
      shipping_option_id: "so_standard",
    },
  ],
} as HttpTypes.StoreCart

const projection = (nextRevision = revision) => ({
  state: "ready_for_payment" as const,
  revision: nextRevision,
  cart: {
    items: [],
    totals: {
      currencyCode: "usd" as const,
      subtotal: 19.99,
      discountTotal: 0,
      shippingTotal: 5,
      taxTotal: 0,
      total: 24.99,
    },
    contact: { email: "buyer@example.test" },
    deliveryAddress: null,
    shippingMethod: null,
  },
  payment: {
    provider: null,
    clientSecret: null,
    status: null,
    canRestart: false,
  },
  confirmation: null,
})

const request = (body: unknown = { revision }) =>
  new NextRequest("https://storefront.test/api/checkout/payment-session", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "storefront.test",
      origin: "https://storefront.test",
      referer: "https://storefront.test/checkout",
      "sec-fetch-site": "same-origin",
      "x-forwarded-for": "192.0.2.45",
    },
    body: JSON.stringify(body),
  })

describe("POST /api/checkout/payment-session", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    guardMocks.guardCheckoutMutation.mockResolvedValue(null)
    activeCartMocks.resolveActiveCheckoutCart.mockResolvedValue({
      ok: true,
      value: { cart, needsCookieRotation: false },
    })
    activeCartMocks.checkoutProjectionResponse.mockReturnValue(
      Response.json({ checkout: projection() })
    )
    projectionMocks.createCheckoutProjection.mockReturnValue(projection())
    paymentMocks.paymentNeedsFinalization.mockReturnValue(false)
    paymentMocks.reusablePreparedPayment.mockReturnValue({
      clientSecret: "pi_test_secret_test",
      status: "pending",
    })
    cartApiMocks.listShippingOptions.mockResolvedValue({
      shipping_options: [
        { id: "so_standard", insufficient_inventory: false },
      ],
    })
    cartApiMocks.addShippingMethod.mockResolvedValue(cart)
    cartApiMocks.calculateTaxes.mockResolvedValue(cart)
    cartApiMocks.getCart.mockResolvedValue(cart)
  })

  it("rejects a stale revision before changing payment state", async () => {
    projectionMocks.createCheckoutProjection.mockReturnValue(
      projection(changedRevision)
    )

    const response = await POST(request())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      code: "checkout_changed",
      checkout: { revision: changedRevision },
    })
    expect(cartApiMocks.listShippingOptions).not.toHaveBeenCalled()
    expect(cartApiMocks.initiatePaymentSession).not.toHaveBeenCalled()
  })

  it("rechecks shipping and tax before reusing an exact session", async () => {
    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(cartApiMocks.listShippingOptions).toHaveBeenCalledWith(
      "cart_signed"
    )
    expect(cartApiMocks.addShippingMethod).toHaveBeenCalledWith(
      "cart_signed",
      "so_standard"
    )
    expect(cartApiMocks.calculateTaxes).toHaveBeenCalledWith("cart_signed")
    expect(cartApiMocks.initiatePaymentSession).not.toHaveBeenCalled()
    expect(paymentMocks.assertPreparedPayment).toHaveBeenCalledWith(cart)
    expect(
      activeCartMocks.checkoutProjectionResponse
    ).toHaveBeenCalledWith(
      expect.objectContaining({ cart }),
      { includeClientSecret: true }
    )
  })

  it("creates one official session only when no exact session is reusable", async () => {
    paymentMocks.reusablePreparedPayment.mockReturnValue(null)
    const preparedCart = { ...cart, id: "cart_signed" }
    cartApiMocks.getCart.mockResolvedValue(preparedCart)

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(cartApiMocks.initiatePaymentSession).toHaveBeenCalledOnce()
    expect(cartApiMocks.initiatePaymentSession).toHaveBeenCalledWith(
      "cart_signed",
      "pp_stripe_stripe",
      cart
    )
    expect(cartApiMocks.getCart).toHaveBeenCalledWith("cart_signed")
    expect(paymentMocks.assertPreparedPayment).toHaveBeenCalledWith(
      preparedCart
    )
  })

  it("does not replace an authorized or captured payment", async () => {
    paymentMocks.paymentNeedsFinalization.mockReturnValue(true)

    const response = await POST(request())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      code: "payment_result_unknown",
    })
    expect(cartApiMocks.initiatePaymentSession).not.toHaveBeenCalled()
  })

  it("returns the refreshed projection when recalculation changes totals", async () => {
    projectionMocks.createCheckoutProjection
      .mockReturnValueOnce(projection())
      .mockReturnValueOnce(projection(changedRevision))

    const response = await POST(request())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      code: "checkout_changed",
      checkout: { revision: changedRevision },
    })
    expect(cartApiMocks.initiatePaymentSession).not.toHaveBeenCalled()
  })

  it("rejects a selected method that is no longer eligible", async () => {
    cartApiMocks.listShippingOptions.mockResolvedValue({
      shipping_options: [],
    })

    const response = await POST(request())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      code: "shipping_changed",
    })
    expect(cartApiMocks.calculateTaxes).not.toHaveBeenCalled()
  })

  it("rejects malformed and caller-expanded inputs", async () => {
    const response = await POST(
      request({ revision, cart_id: "cart_attacker" })
    )

    expect(response.status).toBe(400)
    expect(
      activeCartMocks.resolveActiveCheckoutCart
    ).not.toHaveBeenCalled()
  })
})
