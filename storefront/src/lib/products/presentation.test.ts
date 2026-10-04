import type { HttpTypes } from "@medusajs/types"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { readCatalogPresentations } from "./presentation"

const reads = vi.hoisted(() => ({ plain: vi.fn(), correlated: vi.fn() }))
vi.mock("@/lib/medusa/read-client", () => ({
  fetchMedusaStoreRead: reads.plain,
}))
vi.mock("@/lib/medusa/correlated-client", () => ({
  correlatedMedusaFetch: reads.correlated,
}))
import {
  loadCatalogPresentations,
  presentCartArtwork,
  presentStoreProducts,
} from "./presentation.server"

const row = (productId = "prod_1") => ({
  productId,
  managedMedia: true,
  profile: {
    productType: "merch",
    label: "Records",
    artists: ["Canonical artist"],
    genres: ["Metal"],
    descriptionHtml: "<p>New <strong>description</strong></p>",
    tracklist: ["Track"],
    credits: "Credits",
    pressingNotes: "Notes",
    merch: {
      material: "Cotton",
      fit: null,
      sizeGuide: "S 18 inches",
      care: null,
    },
  },
  images: [
    {
      id: "cpmedia_1",
      url: "https://media.example/new.webp",
      alt: "Original proportions",
      width: 1200,
      height: 600,
    },
  ],
})
const native = () =>
  ({
    id: "prod_1",
    handle: "bare-shirt",
    title: "Native title",
    thumbnail: "https://media.example/old.webp",
    description: "Old",
    images: [],
    variants: [
      {
        id: "variant_1",
        inventory_quantity: 20,
        calculated_price: { calculated_amount: 1.23, currency_code: "usd" },
      },
    ],
    metadata: { artist_names: ["Old artist"] },
  }) as unknown as HttpTypes.StoreProduct

describe("canonical customer presentation", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    reads.plain.mockResolvedValue({ presentations: [row()] })
  })

  it("joins by product identity and preserves native commerce and original image dimensions", async () => {
    const product = native()
    const [presented] = await presentStoreProducts([product])
    expect(presented).toMatchObject({
      title: "Native title",
      description: "New description",
      thumbnail: row().images[0]!.url,
      images: [{ width: 1200, height: 600, rank: 0 }],
      metadata: { artist_names: ["Canonical artist"], product_type: "merch" },
    })
    expect(presented!.variants).toBe(product.variants)
    expect(product.description).toBe("Old")
    expect(presented!.presentation?.profile?.merch.sizeGuide).toBe(
      "S 18 inches"
    )
  })

  it("does not revive legacy artwork or copy after canonical removal", async () => {
    const empty = row()
    empty.images = []
    empty.profile.descriptionHtml = ""
    empty.profile.artists = []
    reads.plain.mockResolvedValue({ presentations: [empty] })
    expect((await presentStoreProducts([native()]))[0]).toMatchObject({
      images: [],
      thumbnail: null,
      description: "",
      metadata: { artist_names: [] },
    })
  })

  it("preserves the explicit legacy case but omits products which became hidden", async () => {
    reads.plain.mockResolvedValue({
      presentations: [
        { productId: "prod_1", profile: null, managedMedia: false, images: [] },
      ],
    })
    expect((await presentStoreProducts([native()]))[0]).toMatchObject({
      thumbnail: native().thumbnail,
      description: "Old",
    })
    reads.plain.mockResolvedValue({ presentations: [] })
    expect(await presentStoreProducts([native()])).toEqual([])
  })

  it.each(["foreign", "duplicate", "extra private field", "malformed"])(
    "rejects %s data",
    (kind) => {
      const data =
        kind === "foreign"
          ? [row("prod_other")]
          : kind === "duplicate"
            ? [row(), row()]
            : kind === "extra private field"
              ? [{ ...row(), storageKey: "private" }]
              : [{ ...row(), images: null }]
      expect(() =>
        readCatalogPresentations({ presentations: data }, ["prod_1"])
      ).toThrow()
    }
  )

  it("bounds and deduplicates reads, including request correlation", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `prod_${i}`)
    const request = new Request("https://store.example/api/cart")
    reads.correlated.mockImplementation(async (_request, _path, init) => ({
      presentations: init.query.product_ids.split(",").map(row),
    }))
    expect(
      (await loadCatalogPresentations([...ids, ids[0]!], request)).size
    ).toBe(51)
    expect(
      reads.correlated.mock.calls.map(
        (call) => call[2].query.product_ids.split(",").length
      )
    ).toEqual([25, 25, 1])
    expect(reads.plain).not.toHaveBeenCalled()
    await expect(
      loadCatalogPresentations(
        Array.from({ length: 201 }, (_, i) => `prod_${i}`)
      )
    ).rejects.toThrow()
  })

  it("projects cart artwork without changing financial snapshots and skips completed carts", async () => {
    const cart = {
      id: "cart_1",
      total: 123,
      items: [
        {
          id: "item_1",
          product_id: "prod_1",
          unit_price: 123,
          quantity: 1,
          thumbnail: native().thumbnail,
        },
      ],
    } as unknown as HttpTypes.StoreCart
    const presented = await presentCartArtwork(cart)
    expect(presented).toMatchObject({
      total: 123,
      items: [
        { unit_price: 123, quantity: 1, thumbnail: row().images[0]!.url },
      ],
    })
    const completed = { ...cart, completed_at: "2026-10-04T01:00:00Z" }
    expect(await presentCartArtwork(completed)).toBe(completed)
    expect(reads.plain).toHaveBeenCalledTimes(1)
  })

  it("retains successful cart mutations on display outages while hiding unverified artwork", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
    reads.plain.mockRejectedValue(new Error("provider private detail"))
    const cart = {
      total: 123,
      items: [
        { product_id: "prod_1", quantity: 2, thumbnail: native().thumbnail },
      ],
    } as unknown as HttpTypes.StoreCart
    const result = await presentCartArtwork(cart)
    expect(result.total).toBe(123)
    expect(result.items![0]).toEqual({ product_id: "prod_1", quantity: 2 })
    expect(warning).toHaveBeenCalledWith(
      "[cart] Managed artwork is temporarily unavailable"
    )
    warning.mockRestore()
  })
})
