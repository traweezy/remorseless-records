import { afterEach, describe, expect, it, vi } from "vitest"

import {
  CheckoutApiError,
  completeCheckout,
  getCheckout,
  getCheckoutShippingOptions,
  prepareCheckoutPayment,
} from "@/features/checkout/api/checkout-api"

const checkout = {
  state: "ready_for_payment",
  revision: `v1.${"a".repeat(43)}`,
  cart: {
    items: [
      {
        availableQuantity: 4,
        id: "item_test",
        productHandle: "test-release",
        productTitle: "Test Release",
        quantity: 1,
        subtotal: 19.99,
        thumbnail: null,
        unitPrice: 19.99,
        variantTitle: "CD",
      },
    ],
    totals: {
      taxCollectionMode: "collect",
      currencyCode: "usd",
      subtotal: 19.99,
      discountTotal: 0,
      shippingTotal: 5,
      taxTotal: 1.75,
      total: 26.74,
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
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("semantic checkout API client", () => {
  it("loads and validates the private checkout projection", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(Response.json({ checkout })))
    vi.stubGlobal("fetch", fetchMock)

    await expect(getCheckout()).resolves.toEqual(checkout)
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/checkout",
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
        method: "GET",
      })
    )
  })

  it("treats an absent active cart as an expected checkout state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(Response.json({ checkout: null })))
    )

    await expect(getCheckout()).resolves.toBeNull()
  })

  it("rejects malformed successful responses at the browser boundary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(Response.json({ checkout: { cart_id: "raw" } }))
      )
    )

    await expect(getCheckout()).rejects.toMatchObject({
      problem: {
        status: 502,
        code: "recovery_required",
      },
    })
  })

  it("preserves a safe server problem and updated checkout projection", async () => {
    const updated = {
      ...checkout,
      revision: `v1.${"b".repeat(43)}`,
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json(
            {
              type: "https://remorselessrecords.com/problems/checkout-changed",
              title: "Your order changed",
              status: 409,
              detail: "Review the updated total before placing your order.",
              code: "checkout_changed",
              checkout: updated,
            },
            { status: 409 }
          )
        )
      )
    )

    const error = await prepareCheckoutPayment(checkout.revision).catch(
      (reason: unknown) => reason
    )
    expect(error).toBeInstanceOf(CheckoutApiError)
    expect(error).toMatchObject({
      problem: {
        code: "checkout_changed",
        checkout: updated,
      },
    })
  })

  it("returns only validated customer-safe shipping options", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json({
            shippingOptions: [
              {
                id: "so_standard",
                name: "Standard",
                description: "Tracked delivery",
                amount: 5,
                currencyCode: "usd",
                insufficientInventory: false,
              },
            ],
          })
        )
      )
    )

    await expect(getCheckoutShippingOptions()).resolves.toEqual([
      expect.objectContaining({ id: "so_standard", amount: 5 }),
    ])
  })

  it("uses a longer bounded timeout for ambiguous completion", async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError"))
            )
          })
      )
    )

    const completion = expect(
      completeCheckout(checkout.revision)
    ).rejects.toMatchObject({
      problem: {
        status: 504,
        code: "recovery_required",
      },
    })
    await vi.advanceTimersByTimeAsync(25_000)
    await completion
  })
})
