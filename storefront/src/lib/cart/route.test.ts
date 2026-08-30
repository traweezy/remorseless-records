import type { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const cartMocks = vi.hoisted(() => ({
  clearCartCookie: vi.fn(),
  createCart: vi.fn(),
  jsonApiProblem: vi.fn(),
  readCartCookie: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/cart/api", () => ({ createCart: cartMocks.createCart }))
vi.mock("@/lib/cart/cookie", () => ({
  clearCartCookie: cartMocks.clearCartCookie,
  readCartCookie: cartMocks.readCartCookie,
}))
vi.mock("@/lib/security/route-guards", () => ({
  jsonApiProblem: cartMocks.jsonApiProblem,
}))

import { readActiveCartId, readOrCreateCartId } from "./route"

const request = new Request("https://storefront.test/api/cart") as NextRequest

beforeEach(() => {
  vi.clearAllMocks()
})

describe("cart route session boundary", () => {
  it("reuses a valid signed cart session", async () => {
    cartMocks.readCartCookie.mockReturnValue({
      cartId: "cart_01ABC",
      status: "valid",
    })

    expect(readActiveCartId(request)).toBe("cart_01ABC")
    await expect(readOrCreateCartId(request)).resolves.toEqual({
      cartId: "cart_01ABC",
      created: false,
    })
    expect(cartMocks.createCart).not.toHaveBeenCalled()
  })

  it("clears an invalid signature while returning a neutral conflict", () => {
    const problem = new Response(null, { status: 409 })
    const cleared = new Response(null, { status: 409 })
    cartMocks.readCartCookie.mockReturnValue({ status: "invalid" })
    cartMocks.jsonApiProblem.mockReturnValue(problem)
    cartMocks.clearCartCookie.mockReturnValue(cleared)

    expect(readActiveCartId(request)).toBe(cleared)
    expect(cartMocks.jsonApiProblem).toHaveBeenCalledWith({
      code: "cart_session_missing",
      detail: "Refresh the cart before trying that update again.",
      request,
      status: 409,
      title: "Cart session missing",
    })
    expect(cartMocks.clearCartCookie).toHaveBeenCalledWith(problem)
  })

  it("returns a conflict for a missing session without writing a cookie", () => {
    const problem = new Response(null, { status: 409 })
    cartMocks.readCartCookie.mockReturnValue({ status: "missing" })
    cartMocks.jsonApiProblem.mockReturnValue(problem)

    expect(readActiveCartId(request)).toBe(problem)
    expect(cartMocks.clearCartCookie).not.toHaveBeenCalled()
  })

  it("creates a cart when no valid signed session exists", async () => {
    cartMocks.readCartCookie.mockReturnValue({ status: "missing" })
    cartMocks.createCart.mockResolvedValue({ id: "cart_01NEW" })

    await expect(readOrCreateCartId(request)).resolves.toEqual({
      cartId: "cart_01NEW",
      created: true,
    })
    expect(cartMocks.createCart).toHaveBeenCalledWith(undefined, request)
  })
})
