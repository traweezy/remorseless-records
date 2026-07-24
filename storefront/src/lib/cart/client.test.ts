import type { HttpTypes } from "@medusajs/types"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { CartClientError } from "@/lib/cart/client"
import { addLineItem, getCart, updateLineItem } from "@/lib/cart/client"

const fetchMock = vi.fn<typeof fetch>()
vi.stubGlobal("fetch", fetchMock)

const jsonResponse = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })

const cart = {
  id: "cart_01K123ABC",
  currency_code: "usd",
  items: [],
} as unknown as HttpTypes.StoreCart

describe("cart client", () => {
  afterEach(() => {
    fetchMock.mockReset()
  })

  it("loads the cookie-backed cart without putting an identifier in the URL", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ cart: null }))

    await expect(getCart()).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/cart")
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      cache: "no-store",
      credentials: "same-origin",
    })
  })

  it("sends mutations to ID-less routes with an idempotency key", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ cart }))

    await expect(addLineItem("variant_01KABC", 2)).resolves.toEqual(cart)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    const headers = new Headers(init?.headers)
    expect(url).toBe("/api/cart/items")
    expect(init?.method).toBe("POST")
    expect(init?.body).toBe(
      JSON.stringify({ variant_id: "variant_01KABC", quantity: 2 })
    )
    expect(headers.get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it("reuses the same idempotency key when a network request is retried", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("connection reset"))
      .mockResolvedValueOnce(jsonResponse({ cart }))

    await expect(addLineItem("variant_01KABC", 1)).resolves.toEqual(cart)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    const secondHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers)
    expect(firstHeaders.get("Idempotency-Key")).toBeTruthy()
    expect(secondHeaders.get("Idempotency-Key")).toBe(
      firstHeaders.get("Idempotency-Key")
    )
    expect(secondHeaders.get("X-Request-ID")).toBe(
      firstHeaders.get("X-Request-ID")
    )
  })

  it("preserves structured server errors for item-level recovery", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          title: "Inventory unavailable",
          detail: "Only one copy remains.",
          code: "inventory_unavailable",
        },
        { status: 422 }
      )
    )

    const request = updateLineItem("line_01KABC", 2)
    await expect(request).rejects.toMatchObject({
      name: "CartClientError",
      message: "Only one copy remains.",
      status: 422,
      code: "inventory_unavailable",
    } satisfies Partial<CartClientError>)
  })
})
