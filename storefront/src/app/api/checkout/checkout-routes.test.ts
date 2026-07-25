import type { HttpTypes } from "@medusajs/types"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const activeCartMocks = vi.hoisted(() => ({
  checkoutProjectionResponse: vi.fn(),
  resolveActiveCheckoutCart: vi.fn(),
}))
const guardMocks = vi.hoisted(() => ({
  guardCheckoutMutation: vi.fn(),
  guardCheckoutRead: vi.fn(),
}))
const cartApiMocks = vi.hoisted(() => ({
  addShippingMethod: vi.fn(),
  calculateTaxes: vi.fn(),
  listShippingOptions: vi.fn(),
  setCartAddresses: vi.fn(),
  setCartEmail: vi.fn(),
}))

vi.mock("next/cache", () => ({ unstable_noStore: vi.fn() }))
vi.mock(
  "@/features/checkout/server/active-cart",
  () => activeCartMocks
)
vi.mock("@/features/checkout/server/guards", () => guardMocks)
vi.mock("@/lib/cart/api", () => cartApiMocks)

import { GET as getCheckout } from "@/app/api/checkout/route"
import { PUT as putContact } from "@/app/api/checkout/contact/route"
import { PUT as putDeliveryAddress } from "@/app/api/checkout/delivery-address/route"
import { PUT as putShippingMethod } from "@/app/api/checkout/shipping-method/route"
import { GET as getShippingOptions } from "@/app/api/checkout/shipping-options/route"

const cart = {
  id: "cart_signed",
  currency_code: "usd",
  items: [{ id: "cali_test", quantity: 1 }],
} as HttpTypes.StoreCart

const request = (
  path: string,
  method: "GET" | "PUT",
  body?: unknown
): NextRequest =>
  new NextRequest(`https://storefront.test${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      host: "storefront.test",
      origin: "https://storefront.test",
      referer: "https://storefront.test/checkout",
      "sec-fetch-site": "same-origin",
      "x-forwarded-for": "192.0.2.44",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

describe("semantic checkout routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    guardMocks.guardCheckoutRead.mockResolvedValue(null)
    guardMocks.guardCheckoutMutation.mockResolvedValue(null)
    activeCartMocks.resolveActiveCheckoutCart.mockResolvedValue({
      ok: true,
      value: { cart, needsCookieRotation: false },
    })
    activeCartMocks.checkoutProjectionResponse.mockImplementation(
      ({ cart: updatedCart }: { cart: HttpTypes.StoreCart }) =>
        Response.json({ checkout: { cartIdSeenByTest: updatedCart.id } })
    )
  })

  it("loads checkout through signed server identity", async () => {
    const response = await getCheckout(
      request("/api/checkout", "GET")
    )

    expect(response.status).toBe(200)
    expect(activeCartMocks.resolveActiveCheckoutCart).toHaveBeenCalledOnce()
  })

  it("persists contact against the signed cart only", async () => {
    cartApiMocks.setCartEmail.mockResolvedValue(cart)

    const response = await putContact(
      request("/api/checkout/contact", "PUT", {
        email: " buyer@example.test ",
      })
    )

    expect(response.status).toBe(200)
    expect(cartApiMocks.setCartEmail).toHaveBeenCalledWith(
      "cart_signed",
      "buyer@example.test"
    )
  })

  it("rejects a caller-supplied cart ID before persistence", async () => {
    const response = await putContact(
      request("/api/checkout/contact", "PUT", {
        email: "buyer@example.test",
        cart_id: "cart_attacker",
      })
    )

    expect(response.status).toBe(400)
    expect(cartApiMocks.setCartEmail).not.toHaveBeenCalled()
  })

  it("normalizes delivery and defaults billing to shipping", async () => {
    cartApiMocks.setCartAddresses.mockResolvedValue(cart)

    const response = await putDeliveryAddress(
      request("/api/checkout/delivery-address", "PUT", {
        shipping_address: {
          first_name: " Test ",
          last_name: " Buyer ",
          address_1: " 354 Oyster Point Boulevard ",
          city: " South San Francisco ",
          province: " ca ",
          postal_code: "94080",
          country_code: "US",
        },
      })
    )

    expect(response.status).toBe(200)
    const normalized = {
      first_name: "Test",
      last_name: "Buyer",
      address_1: "354 Oyster Point Boulevard",
      city: "South San Francisco",
      province: "CA",
      postal_code: "94080",
      country_code: "us",
    }
    expect(cartApiMocks.setCartAddresses).toHaveBeenCalledWith("cart_signed", {
      shipping_address: normalized,
      billing_address: normalized,
    })
  })

  it("rejects an invalid delivery region", async () => {
    const response = await putDeliveryAddress(
      request("/api/checkout/delivery-address", "PUT", {
        shipping_address: {
          first_name: "Test",
          last_name: "Buyer",
          address_1: "1 Test Street",
          city: "Toronto",
          province: "ON",
          postal_code: "M5V 3A8",
          country_code: "ca",
        },
      })
    )

    expect(response.status).toBe(400)
    expect(cartApiMocks.setCartAddresses).not.toHaveBeenCalled()
  })

  it("returns only customer-safe shipping option fields", async () => {
    cartApiMocks.listShippingOptions.mockResolvedValue({
      shipping_options: [
        {
          id: "so_standard",
          name: "Standard Shipping",
          amount: 5,
          insufficient_inventory: false,
          type: { description: "Tracked delivery" },
          provider_id: "standard",
          service_zone: { internal: "not-public" },
        },
      ],
    })

    const response = await getShippingOptions(
      request("/api/checkout/shipping-options", "GET")
    )

    await expect(response.json()).resolves.toEqual({
      shippingOptions: [
        {
          id: "so_standard",
          name: "Standard Shipping",
          description: "Tracked delivery",
          amount: 5,
          currencyCode: "usd",
          insufficientInventory: false,
        },
      ],
    })
  })

  it("rejects a shipping option that is no longer eligible", async () => {
    cartApiMocks.listShippingOptions.mockResolvedValue({
      shipping_options: [],
    })

    const response = await putShippingMethod(
      request("/api/checkout/shipping-method", "PUT", {
        option_id: "so_stale",
      })
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      code: "shipping_changed",
    })
    expect(cartApiMocks.addShippingMethod).not.toHaveBeenCalled()
  })

  it("persists an eligible method and returns server-calculated tax", async () => {
    cartApiMocks.listShippingOptions.mockResolvedValue({
      shipping_options: [
        {
          id: "so_standard",
          insufficient_inventory: false,
        },
      ],
    })
    cartApiMocks.addShippingMethod.mockResolvedValue(cart)
    cartApiMocks.calculateTaxes.mockResolvedValue(cart)

    const response = await putShippingMethod(
      request("/api/checkout/shipping-method", "PUT", {
        option_id: "so_standard",
      })
    )

    expect(response.status).toBe(200)
    expect(cartApiMocks.addShippingMethod).toHaveBeenCalledWith(
      "cart_signed",
      "so_standard"
    )
    expect(cartApiMocks.calculateTaxes).toHaveBeenCalledWith("cart_signed")
  })
})
