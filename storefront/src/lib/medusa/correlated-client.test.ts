import { FetchError } from "@medusajs/js-sdk"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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
    vi.spyOn(console, "info").mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
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

  it("retries transport failures under one shared deadline", async () => {
    vi.useFakeTimers()
    const providerDetail =
      "https://provider.test/private?email=customer@example.test"
    const response = { products: [] }
    fetchMock
      .mockRejectedValueOnce(new TypeError(providerDetail))
      .mockResolvedValueOnce(response)
    const request = new Request("https://storefront.test/api/products")

    const pending = correlatedMedusaFetch(request, "/store/products", {
      method: "GET",
    })
    await vi.advanceTimersByTimeAsync(100)

    await expect(pending).resolves.toBe(response)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstInit = fetchMock.mock.calls[0]?.[1] as
      { signal?: AbortSignal } | undefined
    const secondInit = fetchMock.mock.calls[1]?.[1] as
      { signal?: AbortSignal } | undefined
    const firstSignal = firstInit?.signal
    const secondSignal = secondInit?.signal
    expect(firstSignal).toBeInstanceOf(AbortSignal)
    expect(secondSignal).toBe(firstSignal)
    expect(console.info).toHaveBeenCalledWith(
      "[medusa] Retrying transient provider read",
      { attempt: 2, delay_ms: 100, max_attempts: 2 }
    )
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(
      providerDetail
    )
  })

  it("retries transient Medusa API statuses", async () => {
    vi.useFakeTimers()
    const response = { products: [] }
    fetchMock
      .mockRejectedValueOnce(
        new FetchError("private provider detail", "Unavailable", 503)
      )
      .mockResolvedValueOnce(response)
    const request = new Request("https://storefront.test/api/products")

    const pending = correlatedMedusaFetch(request, "/store/products")
    await vi.advanceTimersByTimeAsync(100)

    await expect(pending).resolves.toBe(response)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("preserves caller cancellation and redacts non-transient failures", async () => {
    const caller = new AbortController()
    fetchMock.mockRejectedValue(
      new FetchError(
        "https://provider.test/private?email=customer@example.test",
        "Bad Request",
        400
      )
    )
    const request = new Request("https://storefront.test/api/products")

    const failure = await correlatedMedusaFetch(request, "/store/products", {
      signal: caller.signal,
    }).catch((error: unknown) => error)

    expect(failure).toMatchObject({
      kind: "unavailable",
      message: "The upstream provider request failed",
      name: "ProviderRequestError",
    })
    expect(JSON.stringify(failure)).not.toContain("customer")
    expect(fetchMock).toHaveBeenCalledOnce()
    const init = fetchMock.mock.calls[0]?.[1] as { signal?: AbortSignal }
    expect(init.signal).toBeInstanceOf(AbortSignal)
    caller.abort()
    expect(init.signal?.aborted).toBe(true)
  })

  it("stops an in-flight read when the incoming request is canceled", async () => {
    const providerDetail = "customer@example.test"
    const requestController = new AbortController()
    const request = new Request("https://storefront.test/api/products", {
      signal: requestController.signal,
    })
    fetchMock.mockImplementation(
      (_path: string, init: { signal?: AbortSignal } = {}) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(new DOMException(providerDetail, "AbortError")),
            { once: true }
          )
        })
    )

    const pending = correlatedMedusaFetch(request, "/store/products")
    requestController.abort()
    const failure = await pending.catch((error: unknown) => error)

    expect(failure).toMatchObject({
      kind: "timeout",
      message: "The upstream provider request timed out",
      name: "ProviderRequestError",
    })
    expect(JSON.stringify(failure)).not.toContain(providerDetail)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("does not retry parser or programming failures", async () => {
    const providerDetail = "customer@example.test"
    fetchMock.mockRejectedValue(new SyntaxError(providerDetail))
    const request = new Request("https://storefront.test/api/products")

    const failure = await correlatedMedusaFetch(
      request,
      "/store/products"
    ).catch((error: unknown) => error)

    expect(failure).toMatchObject({
      kind: "unavailable",
      message: "The upstream provider request failed",
      name: "ProviderRequestError",
    })
    expect(JSON.stringify(failure)).not.toContain(providerDetail)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("rejects unsafe methods before calling Medusa", async () => {
    const request = new Request("https://storefront.test/api/products")

    await expect(
      correlatedMedusaFetch(request, "/store/products", { method: "POST" })
    ).rejects.toThrow(
      new RangeError("Correlated Medusa retries require a safe read method")
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
