import { AdminRequestError, type AdminSdkClient } from "../../lib/admin-request"
import {
  fetchProductGallery,
  galleryInputs,
  galleryPreflight,
  gallerySemantics,
  makeGalleryPrimary,
  moveGalleryLink,
  productGallerySchema,
  putProductGallery,
  type GalleryLink,
  type ProductGallery,
} from "./product-gallery-query"

const link = (id: string, changes: Partial<GalleryLink> = {}): GalleryLink => ({
  id,
  productId: "product_acceptance",
  variantId: null,
  productProfileId: "profile_acceptance",
  mediaAssetId: `asset_${id}`,
  role: "gallery",
  sortOrder: 4,
  isPrimary: false,
  metadata: { import: { source: "original", positions: [3, 1] } },
  asset: {
    id: `asset_${id}`,
    sourceUrl: `https://images.example.test/${id}.webp`,
    altText: "Cover artwork",
    originalFilename: `${id}.webp`,
    lifecycleStatus: "active",
    version: 7,
  },
  ...changes,
})
const gallery = (): ProductGallery => ({
  productId: "product_acceptance",
  version: 12,
  media: [
    link("first", { role: "primary", isPrimary: true, sortOrder: 2 }),
    link("second"),
  ],
})
const clientWith = (payload: unknown): AdminSdkClient => ({
  fetch: jest.fn(async () => payload) as AdminSdkClient["fetch"],
})

describe("managed product gallery API and existing link controls", () => {
  it("loads the native fixture's opaque product ID without inventing a prefix contract", async () => {
    const client = clientWith({
      productId: "product_acceptance",
      version: 0,
      media: [],
    })
    await expect(
      fetchProductGallery("product_acceptance", { client })
    ).resolves.toEqual({
      productId: "product_acceptance",
      version: 0,
      media: [],
    })
    expect(client.fetch).toHaveBeenCalledWith(
      "/admin/catalog/products/product_acceptance/media",
      expect.objectContaining({ method: "GET" })
    )
  })

  it.each(["", "../other", "product/other", "a".repeat(256)])(
    "rejects an unsafe product path %s before fetching",
    async (id) => {
      const client = clientWith(gallery())
      await expect(fetchProductGallery(id, { client })).rejects.toThrow()
      expect(client.fetch).not.toHaveBeenCalled()
    }
  )

  it("rejects a different product's valid response", async () => {
    await expect(
      fetchProductGallery("another_product", { client: clientWith(gallery()) })
    ).rejects.toMatchObject({ kind: "invalid-response" })
  })

  it.each([
    (value: ProductGallery) => ({ ...value, version: -1 }),
    (value: ProductGallery) => ({
      ...value,
      media: [...value.media, value.media[0]],
    }),
    (value: ProductGallery) => ({
      ...value,
      media: [link("first", { productId: "another_product" })],
    }),
    (value: ProductGallery) => ({
      ...value,
      media: [
        link("first", {
          asset: { ...value.media[0]!.asset!, id: "unrelated_asset" },
        }),
      ],
    }),
    (value: ProductGallery) => ({
      ...value,
      media: Array.from({ length: 101 }, (_, index) => link(`item_${index}`)),
    }),
  ])(
    "rejects a malformed or inconsistent gallery response %#",
    async (alter) => {
      await expect(
        fetchProductGallery("product_acceptance", {
          client: clientWith(alter(gallery())),
        })
      ).rejects.toBeInstanceOf(AdminRequestError)
    }
  )

  it("extracts only full existing link semantics without asset writes or link IDs", () => {
    const inputs = galleryInputs(gallery().media)
    expect(inputs[0]).toEqual({
      mediaAssetId: "asset_first",
      variantId: null,
      productProfileId: "profile_acceptance",
      role: "primary",
      sortOrder: 2,
      isPrimary: true,
      metadata: { import: { source: "original", positions: [3, 1] } },
    })
    expect(Object.keys(inputs[0]!)).toHaveLength(7)
    expect(inputs).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ altText: expect.anything() }),
      ])
    )
  })

  it("sends only the actor-bound immutable versioned PUT", async () => {
    const client = clientWith(gallery())
    const body = {
      expectedActorId: "user_original",
      expectedVersion: 11,
      idempotencyKey: "79368c83-8dc1-443a-9b96-2a92a6e9b0cb",
      media: galleryInputs(gallery().media),
    }
    await putProductGallery("product_acceptance", body, { client })
    expect(client.fetch).toHaveBeenCalledWith(
      "/admin/catalog/products/product_acceptance/media",
      expect.objectContaining({ method: "PUT", body })
    )
  })

  it("rejects injected asset fields before any PUT", async () => {
    const client = clientWith(gallery())
    const body = {
      expectedActorId: "user_original",
      expectedVersion: 11,
      idempotencyKey: "79368c83-8dc1-443a-9b96-2a92a6e9b0cb",
      media: [
        {
          ...galleryInputs(gallery().media)[0]!,
          altText: "Changed shared asset",
        },
      ],
    }
    await expect(
      putProductGallery("product_acceptance", body, { client })
    ).rejects.toThrow()
    expect(client.fetch).not.toHaveBeenCalled()
  })

  it("does not send after the captured context becomes obsolete", async () => {
    const client = clientWith(gallery())
    const body = {
      expectedActorId: "user_original",
      expectedVersion: 11,
      idempotencyKey: "79368c83-8dc1-443a-9b96-2a92a6e9b0cb",
      media: [],
    }
    await expect(
      putProductGallery("product_acceptance", body, {
        client,
        isCurrent: () => false,
      })
    ).rejects.toMatchObject({ kind: "cancelled" })
    expect(client.fetch).not.toHaveBeenCalled()
  })

  it("compares the full link multiset independently of replaced IDs and metadata key order", () => {
    const original = gallery().media
    const projection = [...original].reverse().map((item) => ({
      ...item,
      id: `replaced_${item.id}`,
      metadata: { import: { positions: [3, 1], source: "original" } },
    }))
    expect(gallerySemantics(projection)).toBe(gallerySemantics(original))
    expect(gallerySemantics([projection[0]!])).not.toBe(
      gallerySemantics(original)
    )
    expect(
      gallerySemantics(
        projection.map((item) => ({
          ...item,
          metadata: { import: { positions: [1, 3], source: "original" } },
        }))
      )
    ).not.toBe(gallerySemantics(original))
  })

  it("leaves unchanged noncontiguous positions and metadata intact", () => {
    const original = gallery()
    expect(
      galleryPreflight(original.media, "profile_acceptance", [])
    ).toBeNull()
    expect(galleryInputs(original.media).map((item) => item.sortOrder)).toEqual(
      [2, 4]
    )
  })

  it.each([
    {
      profile: undefined,
      media: gallery().media,
      variants: [],
      reason: "profile to load",
    },
    {
      profile: "profile_acceptance",
      media: [link("first", { productProfileId: null, isPrimary: true })],
      variants: [],
      reason: "profile association",
    },
    {
      profile: null,
      media: gallery().media,
      variants: [],
      reason: "profile association",
    },
    {
      profile: "profile_acceptance",
      media: [link("first", { asset: null })],
      variants: [],
      reason: "active managed",
    },
    {
      profile: "profile_acceptance",
      media: [link("first", { variantId: "variant_foreign" })],
      variants: [],
      reason: "unavailable variant",
    },
    {
      profile: "profile_acceptance",
      media: [link("first", { role: "primary" })],
      variants: [],
      reason: "primary flags",
    },
    {
      profile: "profile_acceptance",
      media: [link("first"), link("second")],
      variants: [],
      reason: "same position",
    },
    {
      profile: "profile_acceptance",
      media: [link("first")],
      variants: [],
      reason: "primary product",
    },
    {
      profile: "profile_acceptance",
      media: [link("first", { mediaAssetId: "same", asset: null })],
      variants: [],
      reason: "active managed",
    },
  ])(
    "holds unsafe unchanged re-saves %#",
    ({ profile, media, variants, reason }) => {
      expect(galleryPreflight(media, profile, variants)).toContain(reason)
    }
  )

  it("rejects duplicated assets per scope and multiple primaries", () => {
    const first = gallery().media[0]!
    expect(
      galleryPreflight(
        [first, { ...first, id: "duplicate", sortOrder: 9 }],
        "profile_acceptance",
        []
      )
    ).toContain("appears twice")
    expect(
      galleryPreflight(
        [first, link("second", { isPrimary: true })],
        "profile_acceptance",
        []
      )
    ).toContain("one primary")
  })

  it("sets and demotes primary role only in the selected product or variant scope", () => {
    const originals = [
      ...gallery().media,
      link("variant_first", {
        variantId: "variant_a",
        role: "primary",
        isPrimary: true,
        sortOrder: 0,
      }),
      link("variant_second", {
        variantId: "variant_a",
        role: "variant",
        sortOrder: 1,
      }),
    ]
    const changed = makeGalleryPrimary(originals, "variant_second")
    expect(changed.slice(0, 2)).toEqual(originals.slice(0, 2))
    expect(changed[2]).toMatchObject({
      role: "variant",
      isPrimary: false,
      sortOrder: 0,
    })
    expect(changed[3]).toMatchObject({
      role: "variant",
      isPrimary: true,
      sortOrder: 1,
    })
    expect(
      galleryPreflight(changed, "profile_acceptance", ["variant_a"])
    ).toBeNull()
    const productChanged = makeGalleryPrimary(changed, "second")
    expect(productChanged[0]).toMatchObject({
      role: "gallery",
      isPrimary: false,
    })
    expect(productChanged[1]).toMatchObject({
      role: "primary",
      isPrimary: true,
    })
  })

  it("reorders only a chosen scope and resolves ambiguous positions through explicit action", () => {
    const originals = [
      ...gallery().media,
      link("variant_first", { variantId: "variant_a", sortOrder: 4 }),
      link("variant_second", { variantId: "variant_a", sortOrder: 4 }),
    ]
    const changed = moveGalleryLink(originals, "variant_second", -1)
    expect(changed.slice(0, 2)).toEqual(originals.slice(0, 2))
    expect(changed[2]).toMatchObject({ sortOrder: 1, isPrimary: false })
    expect(changed[3]).toMatchObject({ sortOrder: 0, isPrimary: false })
    expect(
      galleryPreflight(changed, "profile_acceptance", ["variant_a"])
    ).toBeNull()
    expect(moveGalleryLink(changed, "variant_second", -1)).toEqual(changed)
    expect(moveGalleryLink(changed, "not_a_link", 1)).toEqual(changed)
    expect(
      productGallerySchema.parse({ ...gallery(), media: changed }).media
    ).toEqual(changed)
  })
})
