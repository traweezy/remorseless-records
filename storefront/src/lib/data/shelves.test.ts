import { afterEach, describe, expect, it, vi } from "vitest"

describe("homepage catalog shelves", () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("loads shelf products in the resolved merchandising order", async () => {
    const getProductsByIds = vi.fn((ids: readonly string[]) =>
      Promise.resolve(ids.map((id) => ({ id, handle: `handle-${id}` })))
    )
    const getCollectionProductsByHandle = vi.fn()
    const getRecentProducts = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          shelves: [
            {
              shelf: {
                handle: "featured",
                title: "Featured Vault",
                description: "Client-curated selections.",
              },
              productIds: ["prod_2", "prod_1"],
            },
            {
              shelf: {
                handle: "new-releases",
                title: "Newest Arrivals",
                description: null,
              },
              productIds: ["prod_3"],
            },
            {
              shelf: {
                handle: "staff-picks",
                title: "Staff Signals",
                description: "Staff selections.",
              },
              productIds: [],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    )

    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/config/env", () => ({
      runtimeEnv: {
        medusaBackendUrl: "https://backend.example.test",
        medusaPublishableKey: "pk_test",
      },
    }))
    vi.doMock("@/lib/data/products", () => ({
      getCollectionProductsByHandle,
      getProductsByIds,
      getRecentProducts,
    }))
    vi.stubGlobal("fetch", fetchMock)

    const { getHomepageShelves } = await import("@/lib/data/shelves")
    const shelves = await getHomepageShelves()

    expect(shelves.featured).toMatchObject({
      title: "Featured Vault",
      description: "Client-curated selections.",
      products: [
        { id: "prod_2", handle: "handle-prod_2" },
        { id: "prod_1", handle: "handle-prod_1" },
      ],
    })
    expect(shelves["staff-picks"].products).toEqual([])
    expect(getCollectionProductsByHandle).not.toHaveBeenCalled()
    expect(getRecentProducts).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/store/catalog/shelves"),
      expect.objectContaining({
        headers: { "x-publishable-api-key": "pk_test" },
      })
    )
  })

  it("falls back to legacy collections during a staggered deployment", async () => {
    const featured = [{ id: "prod_featured", handle: "featured" }]
    const staff = [{ id: "prod_staff", handle: "staff" }]
    const recent = [{ id: "prod_recent", handle: "recent" }]
    const getCollectionProductsByHandle = vi.fn((handle: string) => {
      if (handle === "featured") return Promise.resolve(featured)
      if (handle === "staff-picks") return Promise.resolve(staff)
      return Promise.resolve([])
    })
    const getRecentProducts = vi.fn().mockResolvedValue(recent)

    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: (...args: never[]) => Promise<unknown>) => fn,
    }))
    vi.doMock("@/config/env", () => ({
      runtimeEnv: {
        medusaBackendUrl: "https://backend.example.test",
        medusaPublishableKey: "pk_test",
      },
    }))
    vi.doMock("@/lib/data/products", () => ({
      getCollectionProductsByHandle,
      getProductsByIds: vi.fn(),
      getRecentProducts,
    }))
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })))
    vi.spyOn(console, "error").mockImplementation(() => undefined)

    const { getHomepageShelves } = await import("@/lib/data/shelves")
    const shelves = await getHomepageShelves()

    expect(shelves.featured.products).toEqual(featured)
    expect(shelves["staff-picks"].products).toEqual(staff)
    expect(shelves["new-releases"].products).toEqual(recent)
    expect(getRecentProducts).toHaveBeenCalledWith(12)
  })
})
