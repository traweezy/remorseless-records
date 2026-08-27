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
  })
})
