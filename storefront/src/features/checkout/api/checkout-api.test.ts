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

  for (const [name, read] of [
    ["checkout", getCheckout],
    ["shipping options", getCheckoutShippingOptions],
  ] as const) {
    it(`cancels ${name} reads without exposing caller abort reasons`, async () => {
      const controller = new AbortController()
      let requestSignal: AbortSignal | null | undefined
      vi.stubGlobal(
        "fetch",
        vi.fn(
          (_input: RequestInfo | URL, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              requestSignal = init?.signal
              requestSignal?.addEventListener("abort", () =>
                reject(new DOMException("transport aborted", "AbortError"))
              )
            })
        )
      )
      const result = expect(
        read({ signal: controller.signal })
      ).rejects.toMatchObject({
        name: "AbortError",
        message: "Checkout request canceled.",
      })
      controller.abort(new Error("private caller detail"))
      expect(requestSignal?.aborted).toBe(true)
      await result
    })

    it(`never starts pre-canceled ${name} reads`, async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal("fetch", fetchMock)
      await expect(
        read({ signal: AbortSignal.abort(new Error("private reason")) })
      ).rejects.toMatchObject({
        name: "AbortError",
        message: "Checkout request canceled.",
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it(`retains the 12 second deadline for ${name} with caller cancellation`, async () => {
      vi.useFakeTimers()
      const controller = new AbortController()
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
      const result = expect(
        read({ signal: controller.signal })
      ).rejects.toMatchObject({
        problem: { status: 504, code: "recovery_required" },
      })
      await vi.advanceTimersByTimeAsync(12_000)
      await result
      expect(controller.signal.aborted).toBe(false)
    })
  }

  it("discards a response body resolved after caller cancellation", async () => {
    const controller = new AbortController()
    let resolveBody!: (value: unknown) => void
    const body = new Promise<unknown>((resolve) => {
      resolveBody = resolve
    })
    let bodyStarted!: () => void
    const readingBody = new Promise<void>((resolve) => {
      bodyStarted = resolve
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => {
            bodyStarted()
            return body
          },
        } as Response)
      )
    )
    const result = expect(
      getCheckout({ signal: controller.signal })
    ).rejects.toMatchObject({
      name: "AbortError",
    })
    await readingBody
    controller.abort()
    resolveBody({ checkout })
    await result
  })
})
