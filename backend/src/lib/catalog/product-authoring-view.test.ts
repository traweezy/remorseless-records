import type {
  CatalogArtistRecord,
  CatalogProductArtistRecord,
  CatalogProductProfileRecord,
  CatalogReferenceValueRecord,
  CatalogVariantProfileRecord,
} from "../../modules/catalog/serializers"
import { buildProductAuthoringView } from "./product-authoring-view"

const productProfile: CatalogProductProfileRecord = {
  content_schema_version: 1,
  created_at: "2026-07-01T00:00:00.000Z",
  credits: {},
  description_html: "<p>Release notes</p>",
  id: "cprof_1",
  label_id: null,
  merch_details: {},
  metadata: {},
  pressing_notes: {},
  product_id: "prod_1",
  product_type_id: "ref_music",
  release_date: "2026-07-01T00:00:00.000Z",
  release_date_precision: "day",
  release_title: "Album",
  release_year: 2026,
  search_keywords: [],
  tracklist: [],
  updated_at: "2026-07-01T00:00:00.000Z",
  version: 3,
}

const artist: CatalogArtistRecord = {
  bio: null,
  created_at: null,
  id: "artist_1",
  image_url: null,
  location: null,
  metadata: {},
  name: "Artist",
  slug: "artist",
  sort_name: "Artist",
  updated_at: null,
}

const artistAssignment: CatalogProductArtistRecord = {
  artist_id: "artist_1",
  created_at: null,
  display_name: "Artist",
  id: "cpartist_1",
  metadata: {},
  product_profile_id: "cprof_1",
  role: "primary",
  sort_order: 0,
  updated_at: null,
}

const reference = (
  id: string,
  kind: string,
  label: string,
  value: string,
): CatalogReferenceValueRecord => ({
  created_at: null,
  description: null,
  id,
  is_active: true,
  kind,
  label,
  metadata: {},
  rank: 0,
  updated_at: null,
  value,
})

const variantProfile: CatalogVariantProfileRecord = {
  availability_status: "available",
  backorder_allowed: false,
  backorder_note: null,
  created_at: null,
  display_label: "CD",
  format_detail_id: null,
  format_detail_label: null,
  format_id: "ref_cd",
  format_label: "CD",
  id: "cvprof_1",
  image_url: null,
  metadata: {},
  preorder_allowed: false,
  preorder_release_date: null,
  product_profile_id: "cprof_1",
  updated_at: null,
  variant_id: "variant_1",
  version: 2,
}

const product = {
  created_at: "2026-07-01T00:00:00.000Z",
  description: "Album",
  discountable: true,
  handle: "album",
  id: "prod_1",
  images: [{ id: "image_1", rank: 0, url: "https://example.com/album.jpg" }],
  metadata: {},
  options: [
    {
      id: "option_1",
      title: "Format",
      values: [{ id: "option_value_1", value: "CD" }],
    },
  ],
  status: "published",
  title: "Album",
  updated_at: "2026-07-01T00:00:00.000Z",
  variants: [
    {
      allow_backorder: false,
      id: "variant_1",
      manage_inventory: true,
      options: [
        {
          id: "option_value_1",
          option: { id: "option_1", title: "Format" },
          option_id: "option_1",
          value: "CD",
        },
      ],
      prices: [
        {
          amount: 24.99,
          currency_code: "usd",
          id: "price_1",
        },
      ],
      rank: 0,
      sku: "ALBUM-CD",
      title: "CD",
    },
  ],
}

describe("buildProductAuthoringView", () => {
  it("combines commerce, catalog, exact stock, and classification facts", () => {
    const view = buildProductAuthoringView({
      artistAssignments: [artistAssignment],
      artists: [artist],
      availabilityByVariantId: { variant_1: 5 },
      availabilityLoaded: true,
      bundleComponents: [],
      bundleProfiles: [],
      media: [],
      product,
      productProfiles: [productProfile],
      referenceAssignments: [],
      referenceValues: [
        reference(
          "ref_music",
          "product_type",
          "Music release",
          "music-release",
        ),
        reference("ref_cd", "format", "CD", "cd"),
      ],
      variantProfiles: [variantProfile],
    })

    expect(view.classification).toMatchObject({
      kind: "music_release",
      status: "classified",
    })
    expect(view.commerce.variants[0]).toMatchObject({
      allowBackorder: false,
      manageInventory: true,
      options: [
        {
          optionId: "option_1",
          optionTitle: "Format",
          value: "CD",
        },
      ],
      prices: [
        {
          amount: 24.99,
          currencyCode: "usd",
        },
      ],
    })
    expect(view.catalog.artists[0]).toMatchObject({
      artist: { id: "artist_1", name: "Artist" },
      assignment: { displayName: "Artist", role: "primary" },
    })
    expect(view.catalog.productType).toMatchObject({
      id: "ref_music",
      label: "Music release",
    })
    expect(view.catalog.variants[0]).toMatchObject({
      format: { id: "ref_cd", label: "CD" },
      status: {
        customerStatus: "low_stock",
        inventoryQuantity: 5,
        inventoryStatus: "low_stock",
      },
      variantId: "variant_1",
    })
    expect(view.diagnostics).toEqual({
      duplicateBundleProfileIds: [],
      duplicateProductProfileIds: [],
      inventoryAvailability: "available",
      missingArtistIds: [],
      missingMediaAssetIds: [],
      missingReferenceValueIds: [],
      missingVariantProfileIds: [],
      orphanVariantProfileIds: [],
    })
  })

  it("surfaces missing relations and orphan variant profiles without throwing", () => {
    const view = buildProductAuthoringView({
      artistAssignments: [
        { ...artistAssignment, artist_id: "artist_missing" },
      ],
      artists: [],
      availabilityByVariantId: {},
      availabilityLoaded: false,
      bundleComponents: [],
      bundleProfiles: [],
      media: [],
      product,
      productProfiles: [productProfile],
      referenceAssignments: [],
      referenceValues: [
        reference(
          "ref_music",
          "product_type",
          "Music release",
          "music-release",
        ),
      ],
      variantProfiles: [
        { ...variantProfile, id: "cvprof_orphan", variant_id: "variant_missing" },
      ],
    })

    expect(view.catalog.artists[0]?.artist).toBeNull()
    expect(view.catalog.variants[0]).toMatchObject({
      profile: null,
      status: {
        customerStatus: "unknown",
        inventoryQuantity: null,
      },
    })
    expect(view.diagnostics).toMatchObject({
      inventoryAvailability: "unavailable",
      missingArtistIds: ["artist_missing"],
      missingVariantProfileIds: ["variant_1"],
      orphanVariantProfileIds: ["cvprof_orphan"],
    })
  })
})
