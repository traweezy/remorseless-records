import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  guardCheckoutRead: vi.fn(),
  resolveActiveCheckoutCart: vi.fn(),
  checkoutProjectionResponse: vi.fn(),
}))
vi.mock("next/cache", () => ({ unstable_noStore: vi.fn() }))
vi.mock("@/features/checkout/server/active-cart", () => mocks)
vi.mock("@/features/checkout/server/guards", () => mocks)

import { GET } from "./route"
import { CheckoutProjectionError } from "@/features/checkout/server/projection"

describe("checkout read boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("returns safe problem JSON when a valid cart envelope cannot be projected", async () => {
    mocks.resolveActiveCheckoutCart.mockResolvedValue({ ok: true, value: {} })
    mocks.checkoutProjectionResponse.mockImplementation(() => {
      throw new CheckoutProjectionError("private provider diagnostic")
    })
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
    try {
      const response = await GET(
        new NextRequest("https://store.test/api/checkout")
      )
      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body).toMatchObject({
        code: "checkout_unavailable",
        detail: "We could not load checkout. Please try again.",
      })
      expect(JSON.stringify(body)).not.toContain("private provider")
      expect(response.headers.has("set-cookie")).toBe(false)
    } finally {
      error.mockRestore()
    }
  })

  it("preserves expected empty state and its cookie cleanup", async () => {
    mocks.resolveActiveCheckoutCart.mockResolvedValue({
      ok: false,
      code: "cart_empty",
      response: new Response(null, {
        headers: { "set-cookie": "cart=; Max-Age=0" },
      }),
    })
    const response = await GET(
      new NextRequest("https://store.test/api/checkout")
    )
    expect(await response.json()).toEqual({ checkout: null })
    expect(response.headers.get("set-cookie")).toBe("cart=; Max-Age=0")
    expect(mocks.checkoutProjectionResponse).not.toHaveBeenCalled()
  })

  it("preserves successful projections and rate limits", async () => {
    const projected = Response.json({
      checkout: { state: "collecting_contact" },
    })
    mocks.resolveActiveCheckoutCart.mockResolvedValue({ ok: true, value: {} })
    mocks.checkoutProjectionResponse.mockReturnValue(projected)
    const request = new NextRequest("https://store.test/api/checkout")
    expect(await GET(request)).toBe(projected)
    const limited = new Response(null, { status: 429 })
    mocks.guardCheckoutRead.mockResolvedValue(limited)
    expect(await GET(request)).toBe(limited)
    expect(mocks.resolveActiveCheckoutCart).toHaveBeenCalledOnce()
  })
})
