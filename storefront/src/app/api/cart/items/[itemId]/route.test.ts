import type { HttpTypes } from "@medusajs/types"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const cartApiMocks = vi.hoisted(() => ({
  getCart: vi.fn(),
  removeLineItem: vi.fn(),
  updateLineItem: vi.fn(),
}))
const cartRouteMocks = vi.hoisted(() => ({
  readActiveCartId: vi.fn(),
}))

vi.mock("next/cache", () => ({ unstable_noStore: vi.fn() }))
vi.mock("@/lib/cart/api", () => cartApiMocks)
vi.mock("@/lib/cart/route", () => cartRouteMocks)

import { DELETE, PATCH } from "@/app/api/cart/items/[itemId]/route"

const cartFixture = (): HttpTypes.StoreCart =>
  ({
    id: "cart_active",
    currency_code: "usd",
    items: [],
  }) as unknown as HttpTypes.StoreCart

const createRequest = (
  method: "DELETE" | "PATCH",
  body?: unknown
): NextRequest =>
  new NextRequest("https://storefront.test/api/cart/items/cali_01ABC", {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      host: "storefront.test",
      "idempotency-key": crypto.randomUUID(),
      origin: "https://storefront.test",
      referer: "https://storefront.test/catalog",
      "sec-fetch-site": "same-origin",
      "x-forwarded-for": "192.0.2.15",
      "x-forwarded-host": "storefront.test",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const context = (itemId: string) => ({
  params: Promise.resolve({ itemId }),
})

describe("/api/cart/items/[itemId]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cartRouteMocks.readActiveCartId.mockResolvedValue("cart_active")
    cartApiMocks.removeLineItem.mockResolvedValue(cartFixture())
    cartApiMocks.updateLineItem.mockResolvedValue(cartFixture())
  })

  it("treats a quantity of zero as a removal", async () => {
    const response = await PATCH(
      createRequest("PATCH", { quantity: 0 }),
      context("cali_01ABC")
    )

    expect(response.status).toBe(200)
    expect(cartApiMocks.removeLineItem).toHaveBeenCalledWith(
      "cart_active",
      "cali_01ABC"
    )
    expect(cartApiMocks.updateLineItem).not.toHaveBeenCalled()
  })

  it("updates positive quantities on the signed active cart", async () => {
    const response = await PATCH(
      createRequest("PATCH", { quantity: 3 }),
      context("cali_01ABC")
    )

    expect(response.status).toBe(200)
    expect(cartApiMocks.updateLineItem).toHaveBeenCalledWith(
      "cart_active",
      "cali_01ABC",
      3
    )
  })

  it("rejects malformed line-item identifiers", async () => {
    const response = await DELETE(
      createRequest("DELETE"),
      context("cart_not_a_line_item")
    )

    expect(response.status).toBe(400)
    expect(cartApiMocks.removeLineItem).not.toHaveBeenCalled()
  })
})
