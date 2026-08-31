import {
  readCatalogArtist,
  readCatalogArtistMutation,
  readCatalogArtistPage,
  readCatalogProductArtists,
  readCatalogProductProfileMutation,
  readCatalogProductProfiles,
  readCatalogProductReferences,
  readCatalogReferenceValue,
  readCatalogReferenceValueMutation,
  readCatalogReferenceValuePage,
  readCatalogVariantProfileMutation,
  readCatalogVariantProfiles,
  readExactCatalogProductArtists,
  readExactCatalogProductReferences,
  readProductProfileOperationResult,
  readProfileOperationList,
  readProfileOperationMutation,
  readVariantProfileOperationResult,
} from "./profile-persistence-contracts"

const INVALID_PROFILE =
  "The catalog profile persistence boundary returned invalid structured data."
const idempotencyKey = "87960e90-348f-4a5d-a195-546b6d1e540f"
const requestSha256 = "a".repeat(64)

const artist = (overrides: Record<string, unknown> = {}) => ({
  bio: "Independent artist",
  created_at: "2026-08-01T00:00:00.000Z",
  id: "artist_1",
  image_url: "https://cdn.example.com/artist.jpg",
  location: "Detroit, MI",
  metadata: {},
  name: "Primary Artist",
  slug: "primary-artist",
  sort_name: "Artist, Primary",
  updated_at: "2026-08-02T00:00:00.000Z",
  ...overrides,
})

const referenceValue = (overrides: Record<string, unknown> = {}) => ({
  created_at: "2026-08-01T00:00:00.000Z",
  description: "Vinyl format",
  id: "cref_1",
  is_active: true,
  kind: "format",
  label: "Vinyl",
  metadata: {},
  rank: 10,
  updated_at: "2026-08-02T00:00:00.000Z",
  value: "vinyl",
  ...overrides,
})

const productProfile = (overrides: Record<string, unknown> = {}) => ({
  content_schema_version: 1,
  created_at: "2026-08-01T00:00:00.000Z",
  credits: {},
  description_html: "<p>Limited edition.</p>",
  id: "cprof_1",
  label_id: "cref_label",
  merch_details: {},
  metadata: {},
  pressing_notes: {},
  product_id: "prod_1",
  product_type_id: "cref_product_type",
  release_date: "2026-08-01T00:00:00.000Z",
  release_date_precision: "day",
  release_title: "Limited Edition",
  release_year: 2026,
  search_keywords: ["vinyl", "limited edition"],
  tracklist: [],
  updated_at: "2026-08-02T00:00:00.000Z",
  version: 2,
  ...overrides,
})

const productArtist = (overrides: Record<string, unknown> = {}) => ({
  artist_id: "artist_1",
  created_at: "2026-08-01T00:00:00.000Z",
  display_name: "Primary Artist",
  id: "cpart_1",
  metadata: {},
  product_profile_id: "cprof_1",
  role: "primary",
  sort_order: 0,
  updated_at: "2026-08-02T00:00:00.000Z",
  ...overrides,
})

const productReference = (overrides: Record<string, unknown> = {}) => ({
  created_at: "2026-08-01T00:00:00.000Z",
  id: "cpref_1",
  kind: "format",
  metadata: {},
  product_profile_id: "cprof_1",
  reference_value_id: "cref_1",
  sort_order: 0,
  updated_at: "2026-08-02T00:00:00.000Z",
  ...overrides,
})

const variantProfile = (overrides: Record<string, unknown> = {}) => ({
  availability_status: "in_stock",
  backorder_allowed: false,
  backorder_note: null,
  created_at: "2026-08-01T00:00:00.000Z",
  display_label: "Black vinyl",
  format_detail_id: "cref_format_detail",
  format_detail_label: "12 inch",
  format_id: "cref_1",
  format_label: "Vinyl",
  id: "cvprof_1",
  image_url: "https://cdn.example.com/variant.jpg",
  metadata: {},
  preorder_allowed: false,
  preorder_release_date: null,
  product_profile_id: "cprof_1",
  updated_at: "2026-08-02T00:00:00.000Z",
  variant_id: "variant_1",
  version: 2,
  ...overrides,
})

const operation = (overrides: Record<string, unknown> = {}) => ({
  actor_id: "user_1",
  aggregate_id: "prod_1",
  command: "catalog.product-profile.mutate",
  completed_at: null,
  error_code: null,
  error_detail: null,
  expected_version: 1,
  id: "catop_1",
  idempotency_key: idempotencyKey,
  metadata: {},
  request_sha256: requestSha256,
  result: {},
  status: "pending",
  ...overrides,
})

describe("catalog profile persistence contracts", () => {
  it("distinguishes absent artist rows from malformed persistence data", () => {
    expect(readCatalogArtist(null, "artist_1")).toBeNull()
    expect(readCatalogArtist(artist(), "artist_1")).toMatchObject({
      id: "artist_1",
      slug: "primary-artist",
    })
    expect(() => readCatalogArtist(false, "artist_1")).toThrow(INVALID_PROFILE)
    expect(() =>
      readCatalogArtist(artist({ image_url: "javascript:alert(1)" }))
    ).toThrow(INVALID_PROFILE)
  })

  it("validates complete counted artist pages and exact writes", () => {
    expect(readCatalogArtistPage([[artist()], 2], 100)).toMatchObject({
      count: 2,
      records: [{ id: "artist_1" }],
    })
    expect(
      readCatalogArtistMutation([artist()], {
        fields: { name: "Primary Artist", metadata: {} },
      }).id
    ).toBe("artist_1")
    expect(() =>
      readCatalogArtistMutation([artist()], {
        fields: { name: "Different artist" },
      })
    ).toThrow(INVALID_PROFILE)
  })

  it.each([
    ["an impossible artist count", [[artist()], 0]],
    ["duplicate artist ids", [[artist(), artist()], 2]],
    ["duplicate artist slugs", [[artist(), artist({ id: "artist_2" })], 2]],
    ["an oversized artist page", [[artist()], 1]],
  ])("rejects %s", (_label, value) => {
    const maximumRows = _label === "an oversized artist page" ? 0 : 100
    expect(() => readCatalogArtistPage(value, maximumRows)).toThrow(
      INVALID_PROFILE
    )
  })

  it("distinguishes absent reference rows and validates exact writes", () => {
    expect(readCatalogReferenceValue(undefined, "cref_1")).toBeNull()
    expect(readCatalogReferenceValue(referenceValue(), "cref_1")).toMatchObject(
      { id: "cref_1", kind: "format" }
    )
    expect(
      readCatalogReferenceValueMutation([referenceValue()], {
        fields: { is_active: true, rank: 10 },
      }).id
    ).toBe("cref_1")
    expect(() =>
      readCatalogReferenceValueMutation([referenceValue()], {
        fields: { rank: 11 },
      })
    ).toThrow(INVALID_PROFILE)
  })

  it.each([
    ["a malformed reference row", [[false], 1]],
    [
      "duplicate reference keys",
      [[referenceValue(), referenceValue({ id: "cref_2" })], 2],
    ],
    [
      "an unsupported reference kind",
      [[referenceValue({ kind: "internal" })], 1],
    ],
    ["a negative reference rank", [[referenceValue({ rank: -1 })], 1]],
  ])("rejects %s", (_label, value) => {
    expect(() => readCatalogReferenceValuePage(value, 100)).toThrow(
      INVALID_PROFILE
    )
  })

  it("validates the singleton Product profile projection and mutation", () => {
    expect(
      readCatalogProductProfiles([productProfile()], "prod_1")
    ).toHaveLength(1)
    expect(
      readCatalogProductProfileMutation([productProfile()], {
        fields: { release_title: "Limited Edition" },
        id: "cprof_1",
        productId: "prod_1",
        version: 2,
      }).version
    ).toBe(2)
  })

  it.each([
    [
      "multiple Product profiles",
      [productProfile(), productProfile({ id: "cprof_2" })],
    ],
    ["a foreign Product profile", [productProfile({ product_id: "prod_2" })]],
    [
      "unsanitized rich text",
      [productProfile({ description_html: '<script>alert("x")</script>' })],
    ],
    [
      "duplicate search keywords",
      [productProfile({ search_keywords: ["vinyl", "vinyl"] })],
    ],
    ["day precision without a date", [productProfile({ release_date: null })]],
  ])("rejects %s", (_label, value) => {
    expect(() => readCatalogProductProfiles(value, "prod_1")).toThrow(
      INVALID_PROFILE
    )
  })

  it("validates relation ownership, identity, and duplicate sort positions", () => {
    const artists = [
      productArtist(),
      productArtist({
        artist_id: "artist_2",
        display_name: "Guest Artist",
        id: "cpart_2",
      }),
    ]
    expect(
      readExactCatalogProductArtists(artists, "cprof_1", [
        {
          artist_id: "artist_1",
          display_name: "Primary Artist",
          metadata: {},
          product_profile_id: "cprof_1",
          role: "primary",
          sort_order: 0,
        },
        {
          artist_id: "artist_2",
          display_name: "Guest Artist",
          metadata: {},
          product_profile_id: "cprof_1",
          role: "primary",
          sort_order: 0,
        },
      ])
    ).toHaveLength(2)
    expect(() =>
      readExactCatalogProductArtists(artists, "cprof_1", [
        {
          display_name: "Wrong artist",
          sort_order: 0,
        },
        {
          display_name: "Guest Artist",
          sort_order: 0,
        },
      ])
    ).toThrow(INVALID_PROFILE)
  })

  it.each([
    [
      "a foreign artist relation",
      [productArtist({ product_profile_id: "cprof_2" })],
    ],
    ["duplicate artist relation ids", [productArtist(), productArtist()]],
    [
      "a foreign reference relation",
      [productReference({ product_profile_id: "cprof_2" })],
    ],
    [
      "duplicate reference identities",
      [productReference(), productReference({ id: "cpref_2" })],
    ],
  ])("rejects %s", (_label, value) => {
    const reader = _label.includes("artist")
      ? readCatalogProductArtists
      : readCatalogProductReferences
    expect(() => reader(value, "cprof_1")).toThrow(INVALID_PROFILE)
  })

  it("requires exact reference relation acknowledgements", () => {
    expect(
      readExactCatalogProductReferences([productReference()], "cprof_1", [
        {
          kind: "format",
          metadata: {},
          product_profile_id: "cprof_1",
          reference_value_id: "cref_1",
          sort_order: 0,
        },
      ])
    ).toHaveLength(1)
    expect(() =>
      readExactCatalogProductReferences([productReference()], "cprof_1", [
        { reference_value_id: "cref_other", sort_order: 0 },
      ])
    ).toThrow(INVALID_PROFILE)
  })

  it("validates the singleton Variant profile projection and mutation", () => {
    expect(
      readCatalogVariantProfiles([variantProfile()], "variant_1")
    ).toHaveLength(1)
    expect(
      readCatalogVariantProfileMutation([variantProfile()], {
        fields: { availability_status: "in_stock" },
        id: "cvprof_1",
        variantId: "variant_1",
        version: 2,
      }).version
    ).toBe(2)
    expect(() =>
      readCatalogVariantProfileMutation(
        [variantProfile({ image_url: "file:///tmp/variant.jpg" })],
        {
          fields: {},
          variantId: "variant_1",
          version: 2,
        }
      )
    ).toThrow(INVALID_PROFILE)
  })

  it("validates exact pending, succeeded, and compensated operations", () => {
    const expected = {
      actorId: "user_1",
      aggregateId: "prod_1",
      command: "catalog.product-profile.mutate",
      expectedVersion: 1,
      idempotencyKey,
      requestSha256,
      status: "pending" as const,
    }
    expect(readProfileOperationList([operation()])?.id).toBe("catop_1")
    expect(readProfileOperationMutation([operation()], expected).status).toBe(
      "pending"
    )
    expect(
      readProfileOperationMutation(
        [
          operation({
            completed_at: "2026-08-02T00:00:00.000Z",
            result: {
              created: false,
              productId: "prod_1",
              profileId: "cprof_1",
              version: 2,
            },
            status: "succeeded",
          }),
        ],
        {
          ...expected,
          id: "catop_1",
          result: {
            created: false,
            productId: "prod_1",
            profileId: "cprof_1",
            version: 2,
          },
          status: "succeeded",
        }
      ).status
    ).toBe("succeeded")
    expect(
      readProfileOperationMutation(
        [
          operation({
            completed_at: "2026-08-02T00:00:00.000Z",
            error_code: "workflow_compensated",
            error_detail: "The workflow rolled back.",
            status: "compensated",
          }),
        ],
        { ...expected, id: "catop_1", status: "compensated" }
      ).status
    ).toBe("compensated")
  })

  it.each([
    ["duplicate operations", [operation(), operation({ id: "catop_2" })]],
    ["a malformed request digest", [operation({ request_sha256: "short" })]],
    ["a nonempty pending result", [operation({ result: { version: 2 } })]],
    [
      "a succeeded result with a forbidden JSON key",
      [
        operation({
          completed_at: "2026-08-02T00:00:00.000Z",
          result: { ["constructor"]: "unsafe" },
          status: "succeeded",
        }),
      ],
    ],
    [
      "a compensated operation without its stable error",
      [
        operation({
          completed_at: "2026-08-02T00:00:00.000Z",
          status: "compensated",
        }),
      ],
    ],
  ])("rejects %s", (_label, value) => {
    expect(() => readProfileOperationList(value)).toThrow(INVALID_PROFILE)
  })

  it("requires exact operation result keys", () => {
    expect(
      readProductProfileOperationResult({
        created: false,
        productId: "prod_1",
        profileId: "cprof_1",
        version: 2,
      })
    ).toMatchObject({ productId: "prod_1", version: 2 })
    expect(
      readVariantProfileOperationResult({
        created: true,
        profileId: "cvprof_1",
        variantId: "variant_1",
        version: 1,
      })
    ).toMatchObject({ variantId: "variant_1", version: 1 })
    expect(() =>
      readProductProfileOperationResult({
        created: false,
        internal: true,
        productId: "prod_1",
        profileId: "cprof_1",
        version: 2,
      })
    ).toThrow(INVALID_PROFILE)
  })
})
