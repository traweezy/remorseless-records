import { beforeEach, describe, expect, it, vi } from "vitest"

import { ProviderRequestError } from "@/lib/http/provider-boundary"

const mocks = vi.hoisted(() => ({
  searchProductsServer: vi.fn(),
}))

vi.mock("@/lib/search/server", () => ({
  searchProductsServer: mocks.searchProductsServer,
}))

vi.mock("@/lib/security/route-guards", () => ({
  enforceRateLimit: vi.fn().mockResolvedValue(null),
  enforceTrustedOrigin: vi.fn().mockReturnValue(null),
  jsonApiError: vi.fn(
    (_request: Request, detail: string, status: number, code: string) =>
      Response.json({ code, detail, status }, { status })
  ),
  jsonApiResponse: vi.fn((body: unknown) => Response.json(body)),
  parseJsonBody: vi.fn().mockResolvedValue({
    data: { query: "doom" },
    ok: true,
  }),
}))

import { POST } from "@/app/api/search/products/route"

const makeRequest = (): Request =>
  new Request("https://storefront.test/api/search/products", {
    body: JSON.stringify({ query: "doom" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  })

describe("search provider error contract", () => {
  beforeEach(() => {
    mocks.searchProductsServer.mockReset()
    vi.spyOn(console, "error").mockImplementation(() => undefined)
  })

  it.each([
    ["timeout", 504, "search_timeout"],
    ["unavailable", 502, "search_unavailable"],
  ] as const)(
    "maps %s provider failures to a safe gateway problem",
    async (kind, expectedStatus, expectedCode) => {
      mocks.searchProductsServer.mockRejectedValue(
        new ProviderRequestError(kind)
      )

      const response = await POST(makeRequest())

      expect(response.status).toBe(expectedStatus)
      await expect(response.json()).resolves.toMatchObject({
        code: expectedCode,
        status: expectedStatus,
      })
    }
  )

  it("keeps unexpected application failures distinct from provider errors", async () => {
    mocks.searchProductsServer.mockRejectedValue(
      new Error("unexpected private implementation detail")
    )

    const response = await POST(makeRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      code: "search_unavailable",
      detail: "Unable to perform search",
      status: 500,
    })
  })
})
