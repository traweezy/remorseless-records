import { afterEach, describe, expect, it, vi } from "vitest"

import { getCartBundleComposition } from "./bundle-client"

const fetchMock = vi.fn<typeof fetch>()

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("cart bundle client", () => {
  it("loads an encoded bundle through the same-origin BFF", async () => {
    const bundle = {
      components: [],
      id: "bundle_01ABC",
      product_id: "prod_01ABC",
    }
    vi.stubGlobal("fetch", fetchMock)
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ bundle }), {
        headers: { "content-type": "application/json" },
      })
    )

    await expect(getCartBundleComposition("title/with space")).resolves.toEqual(
      bundle
    )
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, options] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe("/api/products/title%2Fwith%20space/bundle")
    expect(options).toMatchObject({
      cache: "no-store",
      credentials: "same-origin",
    })
    expect(options?.signal).toBeInstanceOf(AbortSignal)
  })

  it("combines caller cancellation with the bounded request deadline", async () => {
    vi.stubGlobal("fetch", fetchMock)
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ bundle: null }), {
        headers: { "content-type": "application/json" },
      })
    )
    const controller = new AbortController()
    const combineSignals = vi.spyOn(AbortSignal, "any")

    await expect(
      getCartBundleComposition("bundle", controller.signal)
    ).resolves.toBeNull()
    const signal = fetchMock.mock.calls[0]?.[1]?.signal
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(combineSignals).toHaveBeenCalledWith(
      expect.arrayContaining([controller.signal, expect.any(AbortSignal)])
    )
  })

  it("maps an unhealthy BFF response to neutral client copy", async () => {
    vi.stubGlobal("fetch", fetchMock)
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }))

    await expect(getCartBundleComposition("bundle")).rejects.toThrow(
      "Unable to load bundle contents."
    )
  })
})
