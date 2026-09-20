import type { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  ProviderRequestError,
  runProviderReadOperation,
} from "@/lib/http/provider-boundary"

const mocks = vi.hoisted(() => ({
  correlatedMedusaFetch: vi.fn(),
  enforceRateLimit: vi.fn(),
  jsonApiError: vi.fn(
    (_request: Request, detail: string, status: number, code: string) =>
      Response.json({ code, detail, status }, { status })
  ),
  resolveRegionId: vi.fn(),
}))

vi.mock("@/lib/medusa/correlated-client", () => ({
  correlatedMedusaFetch: mocks.correlatedMedusaFetch,
}))

vi.mock("@/lib/regions", () => ({
  resolveRegionId: mocks.resolveRegionId,
}))

vi.mock("@/lib/security/route-guards", () => ({
  enforceRateLimit: mocks.enforceRateLimit,
  jsonApiError: mocks.jsonApiError,
  jsonApiResponse: vi.fn((body: unknown) => Response.json(body)),
}))

import { GET } from "@/app/api/products/[handle]/route"

const makeRequest = (signal?: AbortSignal): NextRequest =>
  new Request("https://storefront.test/api/products/example", {
    ...(signal ? { signal } : {}),
  }) as NextRequest

const routeParams = { params: Promise.resolve({ handle: "example" }) }

describe("product detail cancellation boundary", () => {
  beforeEach(() => {
    mocks.correlatedMedusaFetch.mockReset()
    mocks.enforceRateLimit.mockReset().mockResolvedValue(null)
    mocks.jsonApiError.mockClear()
    mocks.resolveRegionId.mockReset().mockResolvedValue("reg_test")
    vi.spyOn(console, "error").mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("maps a disconnected caller to a 499 without error-level logging", async () => {
    const controller = new AbortController()
    const request = makeRequest(controller.signal)
    mocks.correlatedMedusaFetch.mockImplementation(
      (forwardedRequest: Request) =>
        runProviderReadOperation(
          (providerSignal) =>
            new Promise((_resolve, reject) => {
              providerSignal.addEventListener(
                "abort",
                () => reject(new DOMException("private detail", "AbortError")),
                { once: true }
              )
            }),
          {
            classifyRetry: () => ({ retry: false }),
            signal: forwardedRequest.signal,
          }
        )
    )

    const pending = GET(request, routeParams)
    await vi.waitFor(() => {
      expect(mocks.correlatedMedusaFetch).toHaveBeenCalledWith(
        request,
        "/store/products",
        expect.any(Object)
      )
    })
    controller.abort()

    const response = await pending
    expect(response.status).toBe(499)
    await expect(response.json()).resolves.toMatchObject({
      code: "request_cancelled",
      status: 499,
    })
    expect(console.error).not.toHaveBeenCalled()
  })

  it("returns a valid product without changing the provider read contract", async () => {
    mocks.correlatedMedusaFetch.mockResolvedValue({
      count: 1,
      products: [{ handle: "example", id: "prod_test" }],
    })

    const response = await GET(makeRequest(), routeParams)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      product: { handle: "example", id: "prod_test" },
    })
    expect(console.error).not.toHaveBeenCalled()
  })

  it("returns a stable 404 for a valid handle with no product", async () => {
    mocks.correlatedMedusaFetch.mockResolvedValue({
      count: 0,
      products: [],
    })

    const response = await GET(makeRequest(), routeParams)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      code: "product_not_found",
    })
    expect(console.error).not.toHaveBeenCalled()
  })

  it("rejects an invalid handle before any provider read", async () => {
    const response = await GET(makeRequest(), {
      params: Promise.resolve({ handle: " " }),
    })

    expect(response.status).toBe(400)
    expect(mocks.correlatedMedusaFetch).not.toHaveBeenCalled()
  })

  it("preserves rate limiting before any provider read", async () => {
    mocks.enforceRateLimit.mockResolvedValue(
      new Response(null, { status: 429 })
    )

    const response = await GET(makeRequest(), routeParams)

    expect(response.status).toBe(429)
    expect(mocks.correlatedMedusaFetch).not.toHaveBeenCalled()
  })

  it.each([
    ["timeout", 504, "catalog_timeout"],
    ["unavailable", 502, "catalog_unavailable"],
  ] as const)(
    "preserves a real %s provider failure when the caller remains connected",
    async (kind, status, code) => {
      mocks.correlatedMedusaFetch.mockRejectedValue(
        new ProviderRequestError(kind)
      )

      const response = await GET(makeRequest(), routeParams)

      expect(response.status).toBe(status)
      await expect(response.json()).resolves.toMatchObject({ code, status })
      expect(console.error).toHaveBeenCalledOnce()
    }
  )

  it("does not hide a non-timeout failure merely because the caller disconnected", async () => {
    const controller = new AbortController()
    const request = makeRequest(controller.signal)
    controller.abort()
    mocks.correlatedMedusaFetch.mockRejectedValue(
      new ProviderRequestError("unavailable")
    )

    const response = await GET(request, routeParams)

    expect(response.status).toBe(502)
    expect(console.error).toHaveBeenCalledOnce()
  })

  it("does not turn an unmarked provider timeout into a client cancellation", async () => {
    const controller = new AbortController()
    const request = makeRequest(controller.signal)
    mocks.correlatedMedusaFetch.mockImplementation(() => {
      controller.abort()
      return Promise.reject(new ProviderRequestError("timeout"))
    })

    const response = await GET(request, routeParams)

    expect(response.status).toBe(504)
    expect(console.error).toHaveBeenCalledOnce()
  })

  it("keeps unexpected application errors on the generic failure path", async () => {
    mocks.correlatedMedusaFetch.mockRejectedValue(new Error("private detail"))

    const response = await GET(makeRequest(), routeParams)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      code: "catalog_unavailable",
      detail: "Unable to load product",
    })
    expect(console.error).toHaveBeenCalledOnce()
  })
})
