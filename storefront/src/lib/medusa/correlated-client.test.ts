import { beforeEach, describe, expect, it, vi } from "vitest"

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}))

vi.mock("@/lib/medusa/client", () => ({
  medusa: {
    client: {
      fetch: fetchMock,
    },
  },
}))

import { correlatedMedusaFetch } from "@/lib/medusa/correlated-client"

const TRACE_ID = "0123456789abcdef0123456789abcdef"
const PARENT_ID = "0123456789abcdef"

describe("correlatedMedusaFetch", () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it("preserves caller headers and creates a correlated upstream span", async () => {
    const response = { products: [] }
    fetchMock.mockResolvedValue(response)
    const request = new Request("https://storefront.test/api/products", {
      headers: {
        traceparent: `00-${TRACE_ID}-${PARENT_ID}-01`,
        "x-request-id": "request_03",
      },
    })

    await expect(
      correlatedMedusaFetch(request, "/store/products", {
        headers: { accept: "application/json" },
        method: "GET",
      })
    ).resolves.toBe(response)

    expect(fetchMock).toHaveBeenCalledOnce()
    const [path, init] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string>; method: string },
    ]
    expect(path).toBe("/store/products")
    expect(init.method).toBe("GET")
    expect(init.headers.accept).toBe("application/json")
    expect(init.headers["x-request-id"]).toBe("request_03")
    expect(init.headers.traceparent).toMatch(
      new RegExp(`^00-${TRACE_ID}-[0-9a-f]{16}-01$`)
    )
    expect(init.headers.traceparent).not.toBe(`00-${TRACE_ID}-${PARENT_ID}-01`)
    expect((init as { signal?: unknown }).signal).toBeInstanceOf(AbortSignal)
  })

  it("preserves cancellation and redacts provider failures", async () => {
    const caller = new AbortController()
    fetchMock.mockRejectedValue(
      new Error("https://provider.test/private?email=customer@example.test")
    )
    const request = new Request("https://storefront.test/api/products")

    const failure = await correlatedMedusaFetch(
      request,
      "/store/products",
      { signal: caller.signal }
    ).catch((error: unknown) => error)

    expect(failure).toMatchObject({
      kind: "unavailable",
      message: "The upstream provider request failed",
      name: "ProviderRequestError",
    })
    expect(JSON.stringify(failure)).not.toContain("customer")
    const init = fetchMock.mock.calls[0]?.[1] as { signal?: AbortSignal }
    expect(init.signal).toBeInstanceOf(AbortSignal)
    caller.abort()
    expect(init.signal?.aborted).toBe(true)
  })
})
