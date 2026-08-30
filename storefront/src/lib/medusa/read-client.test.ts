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

import { fetchMedusaStoreRead } from "@/lib/medusa/read-client"

describe("fetchMedusaStoreRead", () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.spyOn(console, "info").mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("forwards read arguments with a bounded provider signal", async () => {
    const response = { products: [] }
    fetchMock.mockResolvedValue(response)

    await expect(
      fetchMedusaStoreRead("/store/products", {
        method: "GET",
        query: { limit: 10 },
      })
    ).resolves.toBe(response)

    expect(fetchMock).toHaveBeenCalledOnce()
    const [path, init] = fetchMock.mock.calls[0] as [
      string,
      {
        method?: string
        query?: Record<string, unknown>
        signal?: AbortSignal
      },
    ]
    expect(path).toBe("/store/products")
    expect(init.method).toBe("GET")
    expect(init.query).toEqual({ limit: 10 })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it("retries transport failures under one shared deadline", async () => {
    vi.useFakeTimers()
    const providerDetail =
      "https://provider.test/private?email=customer@example.test"
    const response = { products: [] }
    fetchMock
      .mockRejectedValueOnce(new TypeError(providerDetail))
      .mockResolvedValueOnce(response)

    const pending = fetchMedusaStoreRead("/store/products")
    await vi.advanceTimersByTimeAsync(100)

    await expect(pending).resolves.toBe(response)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstInit = fetchMock.mock.calls[0]?.[1] as
      | { signal?: AbortSignal }
      | undefined
    const secondInit = fetchMock.mock.calls[1]?.[1] as
      | { signal?: AbortSignal }
      | undefined
    expect(firstInit?.signal).toBeInstanceOf(AbortSignal)
    expect(secondInit?.signal).toBe(firstInit?.signal)
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
    const response = { regions: [] }
    fetchMock
      .mockRejectedValueOnce(
        new FetchError("private provider detail", "Unavailable", 503)
      )
      .mockResolvedValueOnce(response)

    const pending = fetchMedusaStoreRead("/store/regions")
    await vi.advanceTimersByTimeAsync(100)

    await expect(pending).resolves.toBe(response)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("does not retry and redacts non-transient Medusa failures", async () => {
    const providerDetail =
      "https://provider.test/private?email=customer@example.test"
    fetchMock.mockRejectedValue(
      new FetchError(providerDetail, "Bad Request", 400)
    )

    const failure = await fetchMedusaStoreRead("/store/products").catch(
      (error: unknown) => error
    )

    expect(failure).toMatchObject({
      kind: "unavailable",
      message: "The upstream provider request failed",
      name: "ProviderRequestError",
    })
    expect(JSON.stringify(failure)).not.toContain(providerDetail)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("does not retry parser or programming failures", async () => {
    const providerDetail = "customer@example.test"
    fetchMock.mockRejectedValue(new SyntaxError(providerDetail))

    const failure = await fetchMedusaStoreRead("/store/products").catch(
      (error: unknown) => error
    )

    expect(failure).toMatchObject({
      kind: "unavailable",
      message: "The upstream provider request failed",
      name: "ProviderRequestError",
    })
    expect(JSON.stringify(failure)).not.toContain(providerDetail)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("stops an in-flight read when the caller cancels", async () => {
    const providerDetail = "customer@example.test"
    const caller = new AbortController()
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

    const pending = fetchMedusaStoreRead("/store/products", {
      signal: caller.signal,
    })
    caller.abort()
    const failure = await pending.catch((error: unknown) => error)

    expect(failure).toMatchObject({
      kind: "timeout",
      message: "The upstream provider request timed out",
      name: "ProviderRequestError",
    })
    expect(JSON.stringify(failure)).not.toContain(providerDetail)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("rejects unsafe methods before calling Medusa", async () => {
    await expect(
      fetchMedusaStoreRead("/store/products", { method: "POST" })
    ).rejects.toThrow(
      new RangeError("Medusa retries require a safe read method")
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
