import type { HttpTypes } from "@medusajs/types"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const cartApiMocks = vi.hoisted(() => ({
  getCart: vi.fn(),
}))
const cartCookieMocks = vi.hoisted(() => ({
  clearCartCookie: vi.fn(),
  readCartCookie: vi.fn(),
  setCartCookie: vi.fn(),
}))

vi.mock("next/cache", () => ({ unstable_noStore: vi.fn() }))
vi.mock("@/lib/cart/api", () => cartApiMocks)
vi.mock("@/lib/cart/cookie", () => cartCookieMocks)

import { GET } from "@/app/api/cart/route"

const createRequest = (): NextRequest =>
  new NextRequest("https://storefront.test/api/cart", {
    headers: {
      host: "storefront.test",
      "x-forwarded-for": "192.0.2.16",
      "x-forwarded-host": "storefront.test",
    },
  })

const cartFixture = (
  overrides: Partial<HttpTypes.StoreCart> = {}
): HttpTypes.StoreCart =>
  ({
    id: "cart_active",
    currency_code: "usd",
    items: [{ id: "cali_01ABC", quantity: 1 }],
    ...overrides,
  }) as HttpTypes.StoreCart

describe("GET /api/cart", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cartCookieMocks.readCartCookie.mockReturnValue({
      status: "valid",
      cartId: "cart_active",
      needsRotation: false,
    })
    cartCookieMocks.clearCartCookie.mockImplementation(
      (response: Response) => response
    )
    cartCookieMocks.setCartCookie.mockImplementation(
      (response: Response) => response
    )
  })

  it("returns the active cart without extending an unchanged session", async () => {
    const cart = cartFixture()
    cartApiMocks.getCart.mockResolvedValue(cart)

    const response = await GET(createRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ cart })
    expect(cartCookieMocks.setCartCookie).not.toHaveBeenCalled()
  })

  it.each([
    ["completed", cartFixture({ completed_at: "2026-07-01T00:00:00.000Z" })],
    ["empty", cartFixture({ items: [] })],
  ])("clears a %s cart session", async (_label, cart) => {
    cartApiMocks.getCart.mockResolvedValue(cart)

    const response = await GET(createRequest())

    await expect(response.json()).resolves.toEqual({ cart: null })
    expect(cartCookieMocks.clearCartCookie).toHaveBeenCalledOnce()
  })

  it("rotates a valid cookie signed by the previous key", async () => {
    const cart = cartFixture()
    cartCookieMocks.readCartCookie.mockReturnValue({
      status: "valid",
      cartId: "cart_active",
      needsRotation: true,
    })
    cartApiMocks.getCart.mockResolvedValue(cart)

    await GET(createRequest())

    expect(cartCookieMocks.setCartCookie).toHaveBeenCalledWith(
      expect.any(Response),
      "cart_active"
    )
  })
})
