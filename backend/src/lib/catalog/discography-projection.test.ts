import {
  DISCOGRAPHY_REPLACE_CONFIRMATION,
  buildDiscographyProjection,
  isMusicReleaseReference,
  parseDiscographyReplacementCommandOptions,
  type DiscographyProjectionSource,
} from "./discography-projection"

const source = (
  overrides: Partial<DiscographyProjectionSource> = {}
): DiscographyProjectionSource => ({
  artists: [{ displayName: "Test Artist", sortOrder: 0 }],
  collectionTitle: null,
  coverUrl: "https://media.example/cover.jpg",
  label: "Test Label",
  product: {
    handle: "music-release-test-artist-test-album",
    id: "prod_1",
    metadata: {
      catalog_import: {
        catalog_number: "RR-001",
        utility_tags: ["Limited"],
      },
    },
    status: "published",
    title: "Test Album",
    variants: [
      {
        inventoryQuantity: 4,
        manageInventory: true,
        title: "12-inch LP",
      },
      { inventoryQuantity: 0, manageInventory: true, title: "CD" },
    ],
  },
  profile: {
    productTypeValue: "music-release",
    releaseDate: "2025-03-02T00:00:00.000Z",
    releaseTitle: "Test Album",
    releaseYear: 2025,
  },
  references: [
    {
      kind: "genre",
      label: "Death Metal",
      sortOrder: 0,
      value: "death-metal",
    },
  ],
  ...overrides,
})

describe("catalog discography projection", () => {
  it("recognizes the controlled music-release value", () => {
    expect(isMusicReleaseReference("music-release")).toBe(true)
    expect(isMusicReleaseReference("music_release")).toBe(true)
    expect(isMusicReleaseReference("release")).toBe(false)
  })

  it("projects one complete record from a published catalog release", () => {
    expect(buildDiscographyProjection([source()])).toEqual([
      {
        album: "Test Album",
        artist: "Test Artist",
        availability: "in_print",
        catalog_number: "RR-001",
        collection_title: "Test Label",
        cover_alt_text: "Cover art for Test Artist — Test Album",
        cover_url: "https://media.example/cover.jpg",
        formats: ["Vinyl", "CD"],
        genres: ["Death Metal"],
        product_handle: "music-release-test-artist-test-album",
        product_id: "prod_1",
        release_date: new Date("2025-03-02T00:00:00.000Z"),
        release_year: 2025,
        source_mode: "catalog_product",
        tags: ["Limited"],
        title: "Test Album",
        version: 1,
      },
    ])
  })

  it("preserves artist order for split releases", () => {
    const [entry] = buildDiscographyProjection([
      source({
        artists: [
          { displayName: "Second Artist", sortOrder: 1 },
          { displayName: "First Artist", sortOrder: 0 },
        ],
      }),
    ])
    expect(entry?.artist).toBe("First Artist / Second Artist")
  })

  it("rejects unpublished, incomplete, and duplicate projections", () => {
    expect(() =>
      buildDiscographyProjection([
        source({
          product: { ...source().product, status: "draft" },
        }),
      ])
    ).toThrow("not a published")
    expect(() => buildDiscographyProjection([source({ artists: [] })])).toThrow(
      "missing"
    )
    expect(() => buildDiscographyProjection([source(), source()])).toThrow(
      "duplicate product"
    )
  })

  it("requires exact confirmation before replacement", () => {
    expect(() =>
      parseDiscographyReplacementCommandOptions(["--apply"])
    ).toThrow("requires --confirm-replace")
    expect(
      parseDiscographyReplacementCommandOptions([
        "--apply",
        `--confirm-replace=${DISCOGRAPHY_REPLACE_CONFIRMATION}`,
      ])
    ).toEqual({
      apply: true,
      confirmation: DISCOGRAPHY_REPLACE_CONFIRMATION,
      stateDirectory: null,
    })
  })
})
