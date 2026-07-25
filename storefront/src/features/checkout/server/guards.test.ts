import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const rateLimitMocks = vi.hoisted(() => ({
  enforceCartRateLimit: vi.fn(),
}))
const originMocks = vi.hoisted(() => ({
  enforceTrustedOrigin: vi.fn(),
}))

vi.mock("@/lib/security/cart-rate-limit", () => rateLimitMocks)
vi.mock("@/lib/security/route-guards", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/security/route-guards")>()
  return {
    ...original,
    enforceTrustedOrigin: originMocks.enforceTrustedOrigin,
  }
})

import {
  guardCheckoutMutation,
  guardCheckoutRead,
} from "@/features/checkout/server/guards"

const request = () =>
  new NextRequest("https://storefront.test/api/checkout", {
    headers: { "x-forwarded-for": "192.0.2.10" },
  })

describe("checkout route guards", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimitMocks.enforceCartRateLimit.mockResolvedValue(null)
    originMocks.enforceTrustedOrigin.mockReturnValue(null)
  })

  it("maps shared limiter responses to the checkout problem contract", async () => {
    rateLimitMocks.enforceCartRateLimit.mockResolvedValue(
      new Response("limited", {
        status: 429,
        headers: { "Retry-After": "17" },
      })
    )

    const response = await guardCheckoutRead(request(), {
      key: "get",
      max: 10,
    })

    expect(response?.status).toBe(429)
    expect(response?.headers.get("Retry-After")).toBe("17")
    await expect(response?.json()).resolves.toMatchObject({
      code: "rate_limited",
      status: 429,
    })
  })

  it("fails a mutation closed before checking its origin", async () => {
    rateLimitMocks.enforceCartRateLimit.mockResolvedValue(
      new Response("unavailable", { status: 503 })
    )

    const response = await guardCheckoutMutation(request(), {
      key: "complete",
      max: 10,
    })

    expect(response?.status).toBe(503)
    await expect(response?.json()).resolves.toMatchObject({
      code: "recovery_required",
    })
    expect(originMocks.enforceTrustedOrigin).not.toHaveBeenCalled()
  })
})
