import {
  planNativeCatalogMediaProjection,
  projectNativeCatalogMedia,
  restoreNativeCatalogMediaProjection,
} from "./native-media-projection"
import {
  catalogMediaAssetFixture,
  catalogProductMediaItemFixture,
} from "./transaction-persistence-fixtures.test-helpers"

const old = "https://media.example/old.webp"
const cover = "https://media.example/cover.webp"
const variantCover = "https://media.example/variant.webp"
const context = { eventGroupId: "owned-workflow-events" }

const fixture = () => {
  const product: { id: string; thumbnail: string | null; title: string } = {
    id: "prod_1",
    thumbnail: old,
    title: "Native title",
  }
  const variants: {
    id: string
    product_id: string
    thumbnail: string | null
    sku: string
  }[] = [
    { id: "variant_1", product_id: product.id, thumbnail: old, sku: "SKU-1" },
    { id: "variant_2", product_id: product.id, thumbnail: old, sku: "SKU-2" },
  ]
  const items = [
    catalogProductMediaItemFixture({
      id: "cpmedia_1",
      media_asset_id: "cmedia_1",
      is_primary: true,
      sort_order: 0,
    }),
    catalogProductMediaItemFixture({
      id: "cpmedia_2",
      media_asset_id: "cmedia_2",
      variant_id: "variant_1",
      is_primary: true,
      sort_order: 1,
    }),
  ]
  const assets = [
    catalogMediaAssetFixture({ id: "cmedia_1", source_url: cover }),
    catalogMediaAssetFixture({ id: "cmedia_2", source_url: variantCover }),
  ]
  const products = {
    listProducts: jest.fn(async () => [{ ...product }]),
    listProductVariants: jest.fn(async () =>
      variants.map((row) => ({ ...row }))
    ),
    retrieveProduct: jest.fn(async () => ({ ...product })),
    retrieveProductVariant: jest.fn(async (id: string) => ({
      ...variants.find((row) => row.id === id)!,
    })),
    updateProducts: jest.fn(
      async (_id: string, patch: { thumbnail: string | null }) =>
        Object.assign(product, patch)
    ),
    updateProductVariants: jest.fn(
      async (id: string, patch: { thumbnail: string | null }) =>
        Object.assign(variants.find((row) => row.id === id)!, patch)
    ),
  }
  const catalog = {
    listCatalogProductMediaItems: jest.fn(async () => items),
    listCatalogMediaAssets: jest.fn(async () => assets),
  }
  const input = {
    actorId: "user_1",
    aggregateId: "prod_1",
    command: "catalog.product-media.replace" as const,
    expectedVersion: 1,
    idempotencyKey: "00000000-0000-4000-8000-000000000001",
    requestSha256: "a".repeat(64),
    media: [
      { mediaAssetId: "cmedia_1" },
      { mediaAssetId: "cmedia_2", variantId: "variant_1" },
    ],
  }
  const plan = () =>
    planNativeCatalogMediaProjection(products as never, catalog as never, input)
  const project = async () =>
    projectNativeCatalogMedia(
      products as never,
      catalog as never,
      await plan(),
      context
    )
  return {
    assets,
    catalog,
    input,
    items,
    plan,
    product,
    products,
    project,
    variants,
  }
}

describe("native managed artwork projection", () => {
  it("projects canonical Product and scoped Variant artwork with native fallback", async () => {
    const f = fixture()
    const snapshot = await f.project()
    expect(f.product.thumbnail).toBe(cover)
    expect(f.variants.map((row) => row.thumbnail)).toEqual([variantCover, null])
    expect(snapshot).toMatchObject({
      productId: "prod_1",
      product: { previous: old, projected: cover },
    })
    expect(f.products.updateProducts).toHaveBeenCalledWith(
      "prod_1",
      { thumbnail: cover },
      context
    )
    expect(f.products.updateProductVariants).toHaveBeenCalledWith(
      "variant_1",
      { thumbnail: variantCover },
      context
    )
    expect(f.products.updateProductVariants).toHaveBeenCalledWith(
      "variant_2",
      { thumbnail: null },
      context
    )
    expect(f.product.title).toBe("Native title")
    expect(f.variants.map((row) => row.sku)).toEqual(["SKU-1", "SKU-2"])
  })

  it("uses exactly the existing Storefront order across media scopes", async () => {
    const f = fixture()
    f.items[1]!.sort_order = 0
    f.items[0]!.sort_order = 1
    await f.project()
    expect(f.product.thumbnail).toBe(variantCover)
  })

  it("clears managed artwork and overrides for an intentionally empty gallery", async () => {
    const f = fixture()
    f.items.length = 0
    await f.project()
    expect(f.product.thumbnail).toBeNull()
    expect(f.variants.every((row) => row.thumbnail === null)).toBe(true)
    expect(f.catalog.listCatalogMediaAssets).not.toHaveBeenCalled()
  })

  it("ignores quarantined artwork and clears its stale native projection", async () => {
    const f = fixture()
    f.assets[0]!.lifecycle_status = "quarantined"
    f.assets[0]!.quarantined_at = new Date("2026-10-07T00:00:00Z")
    f.assets[0]!.purge_eligible_at = new Date("2026-11-06T00:00:00Z")
    await f.project()
    expect(f.product.thumbnail).toBe(variantCover)
  })

  it("rejects foreign Variant ownership before any native write", async () => {
    const f = fixture()
    f.input.media[1]!.variantId = "variant_foreign"
    await expect(f.plan()).rejects.toThrow("does not belong")
    expect(f.products.updateProducts).not.toHaveBeenCalled()
    expect(f.products.updateProductVariants).not.toHaveBeenCalled()
  })

  it("rejects malformed or unbounded native rows", async () => {
    const f = fixture()
    f.products.listProductVariants.mockResolvedValueOnce(
      Array.from({ length: 101 }, (_, index) => ({
        id: `variant_${index}`,
        product_id: "prod_1",
        thumbnail: old,
        sku: "",
      }))
    )
    await expect(f.plan()).rejects.toThrow("inconsistent data")
    f.products.listProducts.mockResolvedValueOnce([
      { ...f.product, id: "prod_other" },
    ])
    await expect(f.plan()).rejects.toThrow("inconsistent data")
    expect(f.products.updateProducts).not.toHaveBeenCalled()
  })

  it("rejects native thumbnail drift between planning and writes", async () => {
    const f = fixture()
    const plan = await f.plan()
    f.product.thumbnail = "https://media.example/concurrent.webp"
    await expect(
      projectNativeCatalogMedia(
        f.products as never,
        f.catalog as never,
        plan,
        context
      )
    ).rejects.toThrow("inconsistent data")
    expect(f.products.updateProducts).not.toHaveBeenCalled()
  })

  it.each(["javascript:alert(1)", "not-a-url", "", "x".repeat(2_049)])(
    "rejects unsafe or malformed preexisting native thumbnails: %s",
    async (value) => {
      const f = fixture()
      f.product.thumbnail = value
      await expect(f.plan()).rejects.toThrow("inconsistent data")
      expect(f.products.updateProducts).not.toHaveBeenCalled()
    }
  )

  it.each([
    "missing-product",
    "duplicate-variant",
    "wrong-parent",
    "malformed-variant",
  ])("rejects inconsistent native identity: %s", async (boundary) => {
    const f = fixture()
    if (boundary === "missing-product")
      f.products.listProducts.mockResolvedValue([])
    if (boundary === "duplicate-variant") f.variants.push({ ...f.variants[0]! })
    if (boundary === "wrong-parent") f.variants[0]!.product_id = "prod_other"
    if (boundary === "malformed-variant") f.variants[0]!.id = "foreign"
    await expect(f.plan()).rejects.toThrow("inconsistent data")
    expect(f.products.updateProducts).not.toHaveBeenCalled()
    expect(f.products.updateProductVariants).not.toHaveBeenCalled()
  })

  it("rejects a moved Variant and an unplanned linked Variant before writing", async () => {
    const f = fixture()
    const plan = await f.plan()
    f.variants[0]!.product_id = "prod_other"
    await expect(
      projectNativeCatalogMedia(
        f.products as never,
        f.catalog as never,
        plan,
        context
      )
    ).rejects.toThrow("inconsistent data")
    f.variants[0]!.product_id = "prod_1"
    f.items[1]!.variant_id = "variant_other"
    await expect(
      projectNativeCatalogMedia(
        f.products as never,
        f.catalog as never,
        plan,
        context
      )
    ).rejects.toThrow("inconsistent data")
    expect(f.products.updateProducts).not.toHaveBeenCalled()
  })

  it("verifies persisted native writes rather than accepting an acknowledgement", async () => {
    const f = fixture()
    f.products.updateProductVariants.mockImplementationOnce(
      async (id) => f.variants.find((row) => row.id === id)!
    )
    await expect(f.project()).rejects.toThrow("inconsistent data")
    expect(f.product.thumbnail).toBe(old)
    expect(f.variants.map(({ thumbnail }) => thumbnail)).toEqual([old, old])
  })

  it("does not rewrite already synchronized native artwork", async () => {
    const f = fixture()
    f.product.thumbnail = cover
    f.variants[0]!.thumbnail = variantCover
    f.variants[1]!.thumbnail = null
    expect(await f.project()).toEqual({
      productId: "prod_1",
      product: null,
      variants: [],
    })
    expect(f.products.updateProducts).not.toHaveBeenCalled()
    expect(f.products.updateProductVariants).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    "restores partial native writes when a Variant call fails afterPersist=%s",
    async (afterPersist) => {
      const f = fixture()
      const original = f.products.updateProductVariants.getMockImplementation()!
      f.products.updateProductVariants.mockImplementationOnce(
        async (id, patch) => {
          if (afterPersist) await original(id, patch)
          throw new Error("Injected native failure")
        }
      )
      await expect(f.project()).rejects.toThrow("Injected native failure")
      expect(f.product.thumbnail).toBe(old)
      expect(f.variants.map((row) => row.thumbnail)).toEqual([old, old])
    }
  )

  it("restores only owned thumbnail fields and is safe to compensate again", async () => {
    const f = fixture()
    const snapshot = await f.project()
    f.product.title = "Concurrent merchant title"
    f.variants[0]!.sku = "NEW-SKU"
    await restoreNativeCatalogMediaProjection(
      f.products as never,
      snapshot,
      context
    )
    await restoreNativeCatalogMediaProjection(
      f.products as never,
      snapshot,
      context
    )
    expect(f.product).toMatchObject({
      title: "Concurrent merchant title",
      thumbnail: old,
    })
    expect(f.variants[0]).toMatchObject({ sku: "NEW-SKU", thumbnail: old })
  })

  it("refuses compensation drift before restoring any native field", async () => {
    const f = fixture()
    const snapshot = await f.project()
    f.variants[1]!.thumbnail = "https://media.example/concurrent.webp"
    f.products.updateProducts.mockClear()
    f.products.updateProductVariants.mockClear()
    await expect(
      restoreNativeCatalogMediaProjection(
        f.products as never,
        snapshot,
        context
      )
    ).rejects.toThrow("inconsistent data")
    expect(f.products.updateProducts).not.toHaveBeenCalled()
    expect(f.products.updateProductVariants).not.toHaveBeenCalled()
  })

  it.each(["wrong-parent", "changed-product"])(
    "checks compensation ownership before any restoration: %s",
    async (boundary) => {
      const f = fixture()
      const snapshot = await f.project()
      if (boundary === "wrong-parent") f.variants[0]!.product_id = "prod_other"
      else f.product.thumbnail = "https://media.example/unrelated.webp"
      f.products.updateProducts.mockClear()
      f.products.updateProductVariants.mockClear()
      await expect(
        restoreNativeCatalogMediaProjection(
          f.products as never,
          snapshot,
          context
        )
      ).rejects.toThrow("inconsistent data")
      expect(f.products.updateProducts).not.toHaveBeenCalled()
      expect(f.products.updateProductVariants).not.toHaveBeenCalled()
    }
  )

  it("requires native events to be grouped before any mutation", async () => {
    const f = fixture()
    await expect(
      projectNativeCatalogMedia(
        f.products as never,
        f.catalog as never,
        await f.plan(),
        {}
      )
    ).rejects.toThrow("inconsistent data")
    expect(f.products.updateProducts).not.toHaveBeenCalled()
  })
})
