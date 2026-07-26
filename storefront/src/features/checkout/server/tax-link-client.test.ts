import { afterEach, describe, expect, it, vi } from "vitest"

const envMocks = vi.hoisted(() => {
  const checkoutBffSecret = ["bff", "unit", "test", "key"].join("-").repeat(2)
  return {
    checkoutBffSecret,
    clientEnv: {
      medusaPublishableKey: "pk_test_public",
      medusaUrl: "https://backend.test",
    },
    checkoutServerEnv: {
      checkoutBffSecret,
      medusaBackendUrl: "https://backend-internal.test",
    },
  }
})

vi.mock("@/config/env.client", () => ({ clientEnv: envMocks.clientEnv }))
vi.mock("@/config/env.checkout.server", () => ({
  checkoutServerEnv: envMocks.checkoutServerEnv,
}))

import {
  CheckoutTaxLinkError,
  linkCheckoutTax,
} from "@/features/checkout/server/tax-link-client"

afterEach(() => {
  vi.unstubAllGlobals()
  envMocks.checkoutServerEnv.checkoutBffSecret = envMocks.checkoutBffSecret
})

describe("checkout tax-link client", () => {
  it("sends a purpose-bound, server-to-server request", async () => {
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(() =>
      Promise.resolve(
        Response.json({
          generation: 3,
          linked: true,
          provider: "stripe_tax",
          replayed: false,
        })
      )
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(linkCheckoutTax("cart_01K123ABC")).resolves.toBeUndefined()

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBeInstanceOf(URL)
    if (!(url instanceof URL)) {
      throw new Error("Expected checkout tax link to use a URL.")
    }
    expect(url.href).toBe(
      "https://backend-internal.test/store/checkout/tax-link"
    )
    expect(init).toMatchObject({
      method: "POST",
      body: JSON.stringify({ cart_id: "cart_01K123ABC" }),
      cache: "no-store",
    })
    const headers = new Headers(init?.headers)
    expect(headers.get("x-rr-checkout-proof")).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it.each([
    ["network failure", () => Promise.reject(new Error("offline"))],
    [
      "upstream failure",
      () => Promise.resolve(new Response(null, { status: 409 })),
    ],
    [
      "invalid response",
      () => Promise.resolve(Response.json({ linked: false })),
    ],
  ])("fails closed for %s", async (_label, implementation) => {
    vi.stubGlobal("fetch", vi.fn(implementation))

    await expect(linkCheckoutTax("cart_01K123ABC")).rejects.toBeInstanceOf(
      CheckoutTaxLinkError
    )
  })
})
