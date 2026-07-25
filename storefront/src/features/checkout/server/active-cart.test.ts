import type { HttpTypes } from "@medusajs/types"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const cartApiMocks = vi.hoisted(() => ({
  getCart: vi.fn(),
}))
const cookieMocks = vi.hoisted(() => ({
  clearCartCookie: vi.fn(),
  readCartCookie: vi.fn(),
  setCartCookie: vi.fn(),
}))

vi.mock("@/lib/cart/api", () => cartApiMocks)
vi.mock("@/lib/cart/cookie", () => cookieMocks)

import {
  checkoutProjectionResponse,
  resolveActiveCheckoutCart,
  resolveCheckoutCartIdentity,
} from "@/features/checkout/server/active-cart"

const request = () =>
  new NextRequest("https://storefront.test/api/checkout", {
    headers: { host: "storefront.test" },
  })

const cartFixture = (
  overrides: Partial<HttpTypes.StoreCart> = {}
): HttpTypes.StoreCart =>
  ({
    id: "cart_signed",
    currency_code: "usd",
    email: "",
    subtotal: 19.99,
    item_subtotal: 19.99,
    discount_total: 0,
    shipping_total: 0,
    tax_total: 0,
    total: 19.99,
    items: [
      {
        id: "cali_test",
        product_title: "Test Release",
        quantity: 1,
        unit_price: 19.99,
        subtotal: 19.99,
        discount_total: 0,
        tax_total: 0,
        total: 19.99,
      },
    ],
    shipping_methods: [],
    ...overrides,
  }) as HttpTypes.StoreCart

describe("active checkout cart identity", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cookieMocks.clearCartCookie.mockImplementation(
      (response: Response) => response
    )
    cookieMocks.setCartCookie.mockImplementation(
      (response: Response) => response
    )
  })

  it("resolves only the cart in the signed cookie", async () => {
    const cart = cartFixture()
    cookieMocks.readCartCookie.mockReturnValue({
      status: "valid",
      cartId: "cart_signed",
      needsRotation: false,
    })
    cartApiMocks.getCart.mockResolvedValue(cart)

    await expect(resolveActiveCheckoutCart(request())).resolves.toEqual({
      ok: true,
      value: { cart, needsCookieRotation: false },
    })
    expect(cartApiMocks.getCart).toHaveBeenCalledWith("cart_signed")
  })

  it("resolves signed identity without an upstream lookup", () => {
    cookieMocks.readCartCookie.mockReturnValue({
      status: "valid",
      cartId: "cart_signed",
      needsRotation: true,
    })

    expect(resolveCheckoutCartIdentity(request())).toEqual({
      ok: true,
      value: { cartId: "cart_signed", needsCookieRotation: true },
    })
    expect(cartApiMocks.getCart).not.toHaveBeenCalled()
  })

  it.each(["missing", "invalid"] as const)(
    "rejects a %s cookie without an upstream lookup",
    async (status) => {
      cookieMocks.readCartCookie.mockReturnValue({
        status,
        cartId: null,
      })

      const result = await resolveActiveCheckoutCart(request())

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.response.status).toBe(404)
        await expect(result.response.json()).resolves.toMatchObject({
          code: "cart_missing",
        })
      }
      expect(cartApiMocks.getCart).not.toHaveBeenCalled()
      expect(cookieMocks.clearCartCookie).toHaveBeenCalledTimes(
        status === "invalid" ? 1 : 0
      )
    }
  )

  it("keeps completed identity available for authoritative recovery", async () => {
    cookieMocks.readCartCookie.mockReturnValue({
      status: "valid",
      cartId: "cart_signed",
      needsRotation: false,
    })
    cartApiMocks.getCart.mockResolvedValue(
      cartFixture({ completed_at: "2026-07-25T00:00:00.000Z" })
    )

    const result = await resolveActiveCheckoutCart(request())

    expect(result.ok).toBe(false)
    expect(cookieMocks.clearCartCookie).not.toHaveBeenCalled()
  })

  it("clears an empty checkout cart", async () => {
    cookieMocks.readCartCookie.mockReturnValue({
      status: "valid",
      cartId: "cart_signed",
      needsRotation: false,
    })
    cartApiMocks.getCart.mockResolvedValue(cartFixture({ items: [] }))

    const result = await resolveActiveCheckoutCart(request())

    expect(result.ok).toBe(false)
    expect(cookieMocks.clearCartCookie).toHaveBeenCalledOnce()
  })

  it("rotates a previously signed cookie only on the response", () => {
    const cart = cartFixture()

    checkoutProjectionResponse({
      cart,
      needsCookieRotation: true,
    })

    expect(cookieMocks.setCartCookie).toHaveBeenCalledWith(
      expect.any(Response),
      "cart_signed"
    )
  })
})
