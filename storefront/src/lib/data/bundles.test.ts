import { afterEach, describe, expect, it, vi } from "vitest"

import type { BundleComposition } from "@/types/bundle"

const bundleFixture = (
  overrides: Partial<BundleComposition> = {}
): BundleComposition => ({
  productId: "prod_bundle",
  handle: "album-and-shirt",
  title: "Album and shirt",
  type: "physical",
  componentCount: 1,
  unavailableMappingCount: 0,
  hasUnavailableComponents: false,
  components: [
    {
      id: "bundle_component_01",
      title: "Album",
      quantity: 1,
      required: true,
      product: {
        id: "prod_album",
        handle: "album",
        title: "Album",
      },
      availabilityByBundleVariant: [],
    },
  ],
  ...overrides,
})

const loadBundleModule = async (fetch: ReturnType<typeof vi.fn>) => {
  vi.doMock("next/cache", () => ({
    unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
  }))
  vi.doMock("@/lib/medusa/read-client", () => ({
    fetchMedusaStoreRead: fetch,
  }))

  return import("@/lib/data/bundles")
}

describe("getBundleComposition", () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it("returns a non-empty composition using an encoded product handle", async () => {
    const bundle = bundleFixture()
    const fetch = vi.fn().mockResolvedValue({ bundle })
    const { getBundleComposition } = await loadBundleModule(fetch)

    await expect(getBundleComposition("album & shirt")).resolves.toEqual(bundle)
    expect(fetch).toHaveBeenCalledWith(
      "/store/catalog/products/album%20%26%20shirt/bundle",
      { method: "GET" }
    )
  })

  it("hides an empty composition", async () => {
    const fetch = vi.fn().mockResolvedValue({
      bundle: bundleFixture({
        componentCount: 0,
        components: [],
        productId: "prod_single",
      }),
    })
    const { getBundleComposition } = await loadBundleModule(fetch)

    await expect(getBundleComposition("single")).resolves.toBeNull()
  })

  it("fails closed when the provider bundle is internally inconsistent", async () => {
    const fetch = vi.fn().mockResolvedValue({
      bundle: bundleFixture({ componentCount: 2 }),
    })
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined)
    const { getBundleComposition } = await loadBundleModule(fetch)

    await expect(getBundleComposition("invalid")).resolves.toBeNull()
    expect(errorSpy).toHaveBeenCalledWith(
      "[bundle] Failed to load composition",
      { failure: "unavailable" }
    )
  })

  it("fails closed and reports only a safe failure class", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("service unavailable"))
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined)
    const { getBundleComposition } = await loadBundleModule(fetch)

    await expect(getBundleComposition("broken")).resolves.toBeNull()
    expect(errorSpy).toHaveBeenCalledWith(
      "[bundle] Failed to load composition",
      { failure: "unavailable" }
    )
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(
      "service unavailable"
    )
  })

  it("handles non-Error rejections without throwing", async () => {
    const fetch = vi.fn().mockRejectedValue("offline")
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined)
    const { getBundleComposition } = await loadBundleModule(fetch)

    await expect(getBundleComposition("offline")).resolves.toBeNull()
    expect(errorSpy).toHaveBeenCalledWith(
      "[bundle] Failed to load composition",
      { failure: "unavailable" }
    )
  })
})
