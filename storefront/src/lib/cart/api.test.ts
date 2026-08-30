import type { HttpTypes } from "@medusajs/types"
import { beforeEach, describe, expect, it, vi } from "vitest"

const medusaMocks = vi.hoisted(() => ({
  correlatedRead: vi.fn(),
  fetch: vi.fn(),
  read: vi.fn(),
  resolveRegionId: vi.fn(),
}))

vi.mock("@/lib/medusa/client", () => ({
  medusa: {
    client: {
      fetch: medusaMocks.fetch,
    },
  },
  storeClient: {
    cart: {},
    fulfillment: {},
    payment: {},
  },
}))
vi.mock("@/lib/medusa/correlated-client", () => ({
  correlatedMedusaFetch: medusaMocks.correlatedRead,
}))
vi.mock("@/lib/medusa/read-client", () => ({
  fetchMedusaStoreRead: medusaMocks.read,
}))
vi.mock("@/lib/regions", () => ({
  resolveRegionId: medusaMocks.resolveRegionId,
}))

import {
  addLineItem,
  createCart,
  getCart,
  initiatePaymentSession,
  listShippingOptions,
  removeLineItem,
  updateLineItem,
} from "@/lib/cart/api"

const cartFixture = {
  id: "cart_01ABC",
  currency_code: "usd",
  items: [],
} as unknown as HttpTypes.StoreCart

describe("cart Medusa boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    medusaMocks.resolveRegionId.mockResolvedValue("reg_01ABC")
  })

  it("creates an anonymous cart without requiring a customer account", async () => {
    medusaMocks.fetch.mockResolvedValue({ cart: cartFixture })
    medusaMocks.read.mockResolvedValue({ cart: cartFixture })

    await expect(createCart()).resolves.toBe(cartFixture)
    await expect(getCart(cartFixture.id)).resolves.toBe(cartFixture)

    expect(medusaMocks.fetch).toHaveBeenNthCalledWith(
      1,
      "/store/carts",
      expect.objectContaining({
        method: "POST",
        body: { region_id: "reg_01ABC" },
      })
    )
    expect(
      (medusaMocks.fetch.mock.calls[0]?.[1] as { body?: unknown } | undefined)
        ?.body
    ).not.toHaveProperty("customer_id")
    expect(medusaMocks.read).toHaveBeenCalledWith(
      `/store/carts/${cartFixture.id}`,
      expect.objectContaining({ method: "GET" })
    )
    expect(
      (medusaMocks.fetch.mock.calls[0]?.[1] as { signal?: unknown } | undefined)
        ?.signal
    ).toBeInstanceOf(AbortSignal)
    expect(medusaMocks.fetch).toHaveBeenCalledOnce()
  })

  it("correlates incoming cart reads without sending them to the mutation path", async () => {
    const request = new Request("https://store.test/api/cart")
    medusaMocks.correlatedRead.mockResolvedValue({ cart: cartFixture })

    await expect(getCart(cartFixture.id, request)).resolves.toBe(cartFixture)

    expect(medusaMocks.correlatedRead).toHaveBeenCalledWith(
      request,
      `/store/carts/${cartFixture.id}`,
      expect.objectContaining({ method: "GET" })
    )
    expect(medusaMocks.read).not.toHaveBeenCalled()
    expect(medusaMocks.fetch).not.toHaveBeenCalled()
  })

  it("uses the documented line-item methods and returns the parent on delete", async () => {
    medusaMocks.fetch
      .mockResolvedValueOnce({ cart: cartFixture })
      .mockResolvedValueOnce({ cart: cartFixture })
      .mockResolvedValueOnce({ parent: cartFixture })

    await expect(addLineItem(cartFixture.id, "variant_01ABC", 2)).resolves.toBe(
      cartFixture
    )
    await expect(updateLineItem(cartFixture.id, "cali_01ABC", 3)).resolves.toBe(
      cartFixture
    )
    await expect(removeLineItem(cartFixture.id, "cali_01ABC")).resolves.toBe(
      cartFixture
    )

    expect(medusaMocks.fetch).toHaveBeenNthCalledWith(
      1,
      `/store/carts/${cartFixture.id}/line-items`,
      expect.objectContaining({
        method: "POST",
        body: { variant_id: "variant_01ABC", quantity: 2 },
      })
    )
    expect(medusaMocks.fetch).toHaveBeenNthCalledWith(
      3,
      `/store/carts/${cartFixture.id}/line-items/cali_01ABC`,
      expect.objectContaining({
        method: "DELETE",
      })
    )
    expect(
      (medusaMocks.fetch.mock.calls[0]?.[1] as { signal?: unknown } | undefined)
        ?.signal
    ).toBeInstanceOf(AbortSignal)
    expect(
      (medusaMocks.fetch.mock.calls[2]?.[1] as { signal?: unknown } | undefined)
        ?.signal
    ).toBeInstanceOf(AbortSignal)
  })

  it("resolves calculated shipping prices through the provider boundary", async () => {
    medusaMocks.read.mockResolvedValue({
      shipping_options: [
        {
          id: "so_flat",
          name: "Flat",
          price_type: "flat_rate",
          amount: 7,
        },
        {
          id: "so_calculated",
          name: "Calculated",
          price_type: "calculated",
          amount: null,
          insufficient_inventory: false,
        },
        {
          id: "so_failed",
          name: "Failed",
          price_type: "calculated",
          amount: null,
          insufficient_inventory: false,
        },
      ],
      count: 3,
      limit: 20,
      offset: 0,
    })
    medusaMocks.fetch.mockImplementation((path: string) => {
      if (path === "/store/shipping-options/so_calculated/calculate") {
        return Promise.resolve({
          shipping_option: {
            id: "so_calculated",
            amount: 5.5,
            calculated_price: {
              calculated_amount: 5.5,
              is_calculated_price_tax_inclusive: false,
            },
            is_tax_inclusive: false,
          },
        })
      }
      if (path === "/store/shipping-options/so_failed/calculate") {
        return Promise.reject(new Error("provider unavailable"))
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`))
    })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    await expect(listShippingOptions(cartFixture.id)).resolves.toMatchObject({
      shipping_options: [
        { id: "so_flat", amount: 7 },
        {
          id: "so_calculated",
          amount: 5.5,
          insufficient_inventory: false,
        },
      ],
    })
    expect(medusaMocks.fetch).toHaveBeenCalledWith(
      "/store/shipping-options/so_calculated/calculate",
      expect.objectContaining({
        method: "POST",
        body: { cart_id: cartFixture.id, data: {} },
      })
    )
    expect(medusaMocks.read).toHaveBeenCalledWith("/store/shipping-options", {
      method: "GET",
      query: { cart_id: cartFixture.id },
    })
    expect(warn).toHaveBeenCalledWith(
      "Shipping price calculation failed for 1 option(s)."
    )
    warn.mockRestore()
  })

  it("discovers payment providers with a safe read before mutating sessions", async () => {
    const paymentCollection = {
      id: "pay_col_01ABC",
      payment_sessions: [
        {
          id: "payses_01ABC",
          data: { client_secret: "client_secret_test" },
          provider_id: "pp_stripe_stripe",
          status: "pending",
        },
      ],
    } as unknown as HttpTypes.StorePaymentCollection
    const preparedCart = {
      ...cartFixture,
      items: [
        {
          quantity: 1,
          tax_lines: [
            {
              code: "rr_tax:taxrate_io:g1:quote",
              data: {
                fingerprint: "abcdefghijklmnopqrstuvwxyzABCDEFG_0123456789",
                generation: 1,
                provider: "taxrate_io",
              },
              rate: 8,
            },
          ],
        },
      ],
      payment_collection: paymentCollection,
      region_id: "reg_01ABC",
    } as unknown as HttpTypes.StoreCart
    medusaMocks.read.mockResolvedValue({
      payment_providers: [{ id: "pp_stripe_stripe" }],
    })
    medusaMocks.fetch.mockResolvedValue({
      payment_collection: paymentCollection,
    })

    await expect(
      initiatePaymentSession(cartFixture.id, undefined, preparedCart)
    ).resolves.toMatchObject({
      client_secret: "client_secret_test",
      provider_id: "pp_stripe_stripe",
    })

    expect(medusaMocks.read).toHaveBeenCalledWith("/store/payment-providers", {
      method: "GET",
      query: { region_id: "reg_01ABC" },
    })
    expect(medusaMocks.fetch).toHaveBeenCalledOnce()
    expect(medusaMocks.fetch).toHaveBeenCalledWith(
      "/store/payment-collections/pay_col_01ABC/payment-sessions",
      expect.objectContaining({ method: "POST" })
    )
  })

  it("keeps failed cart mutations single-attempt", async () => {
    medusaMocks.fetch.mockRejectedValue(new TypeError("provider unavailable"))

    await expect(
      addLineItem(cartFixture.id, "variant_01ABC", 1)
    ).rejects.toThrow("provider unavailable")

    expect(medusaMocks.fetch).toHaveBeenCalledOnce()
    expect(medusaMocks.read).not.toHaveBeenCalled()
    expect(medusaMocks.correlatedRead).not.toHaveBeenCalled()
  })
})
