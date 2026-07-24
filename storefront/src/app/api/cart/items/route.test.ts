import type { HttpTypes } from "@medusajs/types"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const cartApiMocks = vi.hoisted(() => ({
  addLineItem: vi.fn(),
  createCart: vi.fn(),
  getCart: vi.fn(),
}))
const cartCookieMocks = vi.hoisted(() => ({
  setCartCookie: vi.fn(),
}))
const cartRouteMocks = vi.hoisted(() => ({
  readOrCreateCartId: vi.fn(),
}))

vi.mock("next/cache", () => ({ unstable_noStore: vi.fn() }))
vi.mock("@/lib/cart/api", () => cartApiMocks)
vi.mock("@/lib/cart/cookie", () => cartCookieMocks)
vi.mock("@/lib/cart/route", () => cartRouteMocks)

import { POST } from "@/app/api/cart/items/route"

const cartFixture = (id: string): HttpTypes.StoreCart =>
  ({
    id,
    currency_code: "usd",
    items: [],
  }) as unknown as HttpTypes.StoreCart

const createRequest = (
  payload: unknown,
  headers: Record<string, string> = {}
): NextRequest =>
  new NextRequest("https://storefront.test/api/cart/items", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "storefront.test",
      "idempotency-key": crypto.randomUUID(),
      origin: "https://storefront.test",
      referer: "https://storefront.test/catalog",
      "sec-fetch-site": "same-origin",
      "x-forwarded-for": "192.0.2.14",
      "x-forwarded-host": "storefront.test",
      ...headers,
    },
    body: JSON.stringify(payload),
  })

describe("POST /api/cart/items", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cartCookieMocks.setCartCookie.mockImplementation(
      (response: Response) => response
    )
  })

  it("adds to the active signed cart without accepting a cart ID from input", async () => {
    const cart = cartFixture("cart_active")
    cartRouteMocks.readOrCreateCartId.mockResolvedValue({
      cartId: cart.id,
      created: false,
    })
    cartApiMocks.addLineItem.mockResolvedValue(cart)

    const response = await POST(
      createRequest({ variant_id: "variant_01ABC", quantity: 2 })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ cart })
    expect(cartApiMocks.addLineItem).toHaveBeenCalledWith(
      "cart_active",
      "variant_01ABC",
      2
    )
  })

  it("replaces a stale cart once before adding the line item", async () => {
    const staleError = Object.assign(new Error("cart missing"), {
      status: 404,
    })
    const freshCart = cartFixture("cart_fresh")
    const populatedCart = {
      ...freshCart,
      items: [{ id: "cali_new", variant_id: "variant_01ABC", quantity: 1 }],
    } as HttpTypes.StoreCart
    cartRouteMocks.readOrCreateCartId.mockResolvedValue({
      cartId: "cart_stale",
      created: false,
    })
    cartApiMocks.addLineItem
      .mockRejectedValueOnce(staleError)
      .mockResolvedValueOnce(populatedCart)
    cartApiMocks.createCart.mockResolvedValue(freshCart)

    const response = await POST(
      createRequest({ variant_id: "variant_01ABC", quantity: 1 })
    )

    expect(response.status).toBe(200)
    expect(cartCookieMocks.setCartCookie).toHaveBeenCalledWith(
      expect.any(Response),
      "cart_fresh"
    )
    expect(cartApiMocks.addLineItem).toHaveBeenNthCalledWith(
      2,
      "cart_fresh",
      "variant_01ABC",
      1
    )
  })

  it("replays the same add request without adding inventory twice", async () => {
    const key = crypto.randomUUID()
    const cart = cartFixture("cart_replayed")
    cartRouteMocks.readOrCreateCartId.mockResolvedValue({
      cartId: cart.id,
      created: false,
    })
    cartApiMocks.addLineItem.mockResolvedValue(cart)
    cartApiMocks.getCart.mockResolvedValue(cart)
    const payload = { variant_id: "variant_01ABC", quantity: 1 }

    const first = await POST(createRequest(payload, { "idempotency-key": key }))
    const replayed = await POST(
      createRequest(payload, { "idempotency-key": key })
    )

    expect(first.status).toBe(200)
    expect(replayed.status).toBe(200)
    expect(replayed.headers.get("Idempotency-Replayed")).toBe("true")
    expect(cartApiMocks.addLineItem).toHaveBeenCalledOnce()
    expect(cartApiMocks.getCart).toHaveBeenCalledWith("cart_replayed")
  })

  it("rejects cross-site mutation requests before reading cart state", async () => {
    const response = await POST(
      createRequest(
        { variant_id: "variant_01ABC", quantity: 1 },
        {
          origin: "https://attacker.test",
          referer: "https://attacker.test/",
          "sec-fetch-site": "cross-site",
        }
      )
    )

    expect(response.status).toBe(403)
    expect(cartRouteMocks.readOrCreateCartId).not.toHaveBeenCalled()
    expect(cartApiMocks.addLineItem).not.toHaveBeenCalled()
  })

  it("rejects invalid quantities before changing the cart", async () => {
    const response = await POST(
      createRequest({ variant_id: "variant_01ABC", quantity: 101 })
    )

    expect(response.status).toBe(400)
    expect(cartApiMocks.addLineItem).not.toHaveBeenCalled()
  })
})
