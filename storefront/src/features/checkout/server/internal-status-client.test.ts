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

vi.mock("@/config/env.client", () => ({
  clientEnv: envMocks.clientEnv,
}))
vi.mock("@/config/env.checkout.server", () => ({
  checkoutServerEnv: envMocks.checkoutServerEnv,
}))

import {
  CheckoutStatusUnavailableError,
  fetchInternalCheckoutStatus,
} from "@/features/checkout/server/internal-status-client"

afterEach(() => {
  vi.unstubAllGlobals()
  envMocks.checkoutServerEnv.checkoutBffSecret = envMocks.checkoutBffSecret
})

describe("internal checkout status client", () => {
  it("sends a signed, bounded server-to-server request", async () => {
    const traceId = "0123456789abcdef0123456789abcdef"
    const request = new Request("https://storefront.test/api/checkout/status", {
      headers: {
        traceparent: `00-${traceId}-0123456789abcdef-01`,
        "x-request-id": "request_status_01",
      },
    })
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(() =>
      Promise.resolve(
        Response.json({
          state: "finalizing_order",
        })
      )
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      fetchInternalCheckoutStatus("cart_01K123ABC", request)
    ).resolves.toEqual({ state: "finalizing_order" })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(init).toBeDefined()
    expect(url).toBeInstanceOf(URL)
    if (!(url instanceof URL)) {
      throw new Error("Expected the status client to call a URL")
    }
    expect(url.toString()).toBe(
      "https://backend-internal.test/store/checkout/status"
    )
    expect(init).toMatchObject({
      method: "POST",
      cache: "no-store",
      body: JSON.stringify({ cart_id: "cart_01K123ABC" }),
    })
    const headers = new Headers(init?.headers)
    expect(headers.get("x-publishable-api-key")).toBe("pk_test_public")
    expect(headers.get("x-rr-checkout-proof")).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(headers.get("x-request-id")).toBe("request_status_01")
    expect(headers.get("traceparent")).toMatch(
      new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`)
    )
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it.each([
    ["upstream error", () => Promise.reject(new Error("offline"))],
    [
      "upstream status",
      () => Promise.resolve(new Response(null, { status: 503 })),
    ],
    [
      "invalid response",
      () => Promise.resolve(Response.json({ state: "not-a-real-state" })),
    ],
  ])("fails closed for %s", async (_label, implementation) => {
    vi.stubGlobal("fetch", vi.fn(implementation))

    await expect(
      fetchInternalCheckoutStatus("cart_01K123ABC")
    ).rejects.toBeInstanceOf(CheckoutStatusUnavailableError)
  })

  it("fails before fetch when recovery is not configured", async () => {
    envMocks.checkoutServerEnv.checkoutBffSecret = ""
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(fetchInternalCheckoutStatus("cart_01K123ABC")).rejects.toThrow(
      "Checkout recovery is not configured"
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
