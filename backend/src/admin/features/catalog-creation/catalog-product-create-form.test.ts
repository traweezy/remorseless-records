import {
  applyCatalogCreationKind,
  buildCatalogProductCreateRequest,
  catalogCreationDraftTtlMs,
  catalogCreationFormSchema,
  createCatalogCreationDefaults,
  createCatalogCreationMerchandiseOfferings,
  parseCatalogCreationDraft,
  resolveCatalogCreationHandle,
  serializeCatalogCreationDraft,
  validateCatalogCreationStep,
  type CatalogCreationProductChoice,
  type CatalogCreationVocabulary,
} from "./catalog-product-create-form"

const choices: CatalogCreationProductChoice[] = [
  {
    id: "component_product",
    title: "Component release",
    variants: [
      { id: "component_cd", sku: "COMP-CD", title: "CD" },
      { id: "component_lp", sku: "COMP-LP", title: "LP" },
    ],
  },
]

const vocabulary: CatalogCreationVocabulary = {
  artists: [{ id: "artist_existing", name: "The Artist" }],
  references: [
    {
      id: "reference_genre",
      isActive: true,
      kind: "genre",
      label: "Death metal",
    },
    {
      id: "reference_label",
      isActive: true,
      kind: "label",
      label: "Remorseless Records",
    },
    {
      id: "reference_merch_type",
      isActive: true,
      kind: "merch_type",
      label: "Shirt",
    },
    {
      id: "reference_product_type",
      isActive: true,
      kind: "product_type",
      label: "Music Release",
    },
  ],
}

describe("catalog product creation form", () => {
  it("previews the same generated handle used by the backend", () => {
    expect(resolveCatalogCreationHandle("", "  Á New Record!  ")).toBe(
      "a-new-record",
    )
    expect(resolveCatalogCreationHandle("custom-record", "Ignored")).toBe(
      "custom-record",
    )
    expect(resolveCatalogCreationHandle("", "---")).toBe("draft-product")
  })

  it("switches kinds without leaking incompatible offerings or components", () => {
    const music = createCatalogCreationDefaults()
    music.bundleComponents = [
      {
        id: "component",
        offeringIds: [music.offerings[0]!.id],
        productId: "component_product",
        quantity: "1",
        variantId: "component_cd",
      },
    ]

    const merch = applyCatalogCreationKind(music, "merch")

    expect(merch.productType).toBe("Merchandise")
    expect(merch.bundleComponents).toEqual([])
    expect(merch.offerings).toHaveLength(1)
    expect(merch.offerings[0]).toMatchObject({ size: "One size" })
    expect(validateCatalogCreationStep(merch, 1)).toContain(
      "Choose or enter a merchandise type.",
    )
  })

  it("reports only errors owned by the active step", () => {
    const values = createCatalogCreationDefaults()

    expect(validateCatalogCreationStep(values, 0)).toEqual([])
    expect(validateCatalogCreationStep(values, 1)).toEqual(
      expect.arrayContaining([
        "Enter a product name.",
        "Choose or enter the primary artist.",
      ]),
    )
    expect(validateCatalogCreationStep(values, 2)).toEqual([])
  })

  it("builds music variants, catalog fields, and exact zero stock", () => {
    const values = createCatalogCreationDefaults()
    values.title = "A New Record"
    values.artistName = "The Artist"
    values.genre = "Death metal"
    values.catalogNumber = "RR-100"
    values.tracklist = "First song\nSecond song"
    values.offerings[0] = {
      ...values.offerings[0]!,
      format: "Vinyl",
      formatDetail: "Red LP",
      priceUsd: "24.50",
      sku: "RR-100-LP",
      stockQuantity: "0",
      title: "Red LP",
    }

    const request = buildCatalogProductCreateRequest(
      values,
      "00000000-0000-4000-8000-000000000001",
      [],
    )

    expect(request).toMatchObject({
      kind: "music_release",
      options: [{ title: "Format", values: ["Red LP"] }],
      profile: {
        metadata: { catalog_number: "RR-100" },
        references: [{ kind: "genre", label: "Death metal", sortOrder: 0 }],
        tracklist: ["First song", "Second song"],
      },
      variants: [
        {
          key: "red-lp",
          prices: [{ amount: 24.5, currencyCode: "usd" }],
          stockQuantity: 0,
        },
      ],
    })
  })

  it("builds media in visual order and requires useful alt text", () => {
    const values = createCatalogCreationDefaults()
    values.title = "A New Record"
    values.artistName = "The Artist"
    values.media = [
      {
        altText: "Red album cover with the band logo",
        byteSize: 1_024,
        id: "draft_media_1",
        mediaAssetId: "media_asset_1",
        mimeType: "image/jpeg",
        originalFilename: "cover.jpg",
        sourceFileKey: "file_1",
        sourceUrl: "https://cdn.example.com/cover.jpg",
      },
      {
        altText: "Back cover with track names",
        byteSize: 2_048,
        id: "draft_media_2",
        mediaAssetId: "media_asset_2",
        mimeType: "image/webp",
        originalFilename: "back.webp",
        sourceFileKey: "file_2",
        sourceUrl: "https://cdn.example.com/back.webp",
      },
    ]

    const request = buildCatalogProductCreateRequest(
      values,
      "00000000-0000-4000-8000-000000000001",
      [],
    )

    expect(request.media).toEqual([
      {
        altText: "Red album cover with the band logo",
        isPrimary: true,
        mediaAssetId: "media_asset_1",
        role: "primary",
        sortOrder: 0,
      },
      {
        altText: "Back cover with track names",
        isPrimary: false,
        mediaAssetId: "media_asset_2",
        role: "gallery",
        sortOrder: 1,
      },
    ])

    values.media[1]!.altText = ""
    expect(validateCatalogCreationStep(values, 3)).toContain(
      "Describe every image for customers who cannot see it.",
    )
  })

  it("maps preorder intent to native backorders and a dated catalog profile", () => {
    const values = createCatalogCreationDefaults()
    values.title = "A Future Record"
    values.artistName = "The Artist"
    values.releaseDate = "2099-08-01"
    values.releaseDatePrecision = "day"
    values.offerings[0] = {
      ...values.offerings[0]!,
      availabilityPolicy: "preorder",
      stockQuantity: "0",
    }

    const request = buildCatalogProductCreateRequest(
      values,
      "00000000-0000-4000-8000-000000000001",
      [],
    )

    expect(request.variants[0]).toMatchObject({
      allowBackorder: true,
      profile: {
        preorderAllowed: true,
        preorderReleaseDate: "2099-08-01",
      },
      stockQuantity: 0,
    })
  })

  it("reuses controlled values and preserves release date precision", () => {
    const values = createCatalogCreationDefaults()
    values.title = "A New Record"
    values.artistName = "The Artist"
    values.genre = "Death metal"
    values.releaseDate = "2026-08"
    values.releaseDatePrecision = "month"

    const request = buildCatalogProductCreateRequest(
      values,
      "00000000-0000-4000-8000-000000000001",
      [],
      vocabulary,
    )

    expect(request.profile).toMatchObject({
      artists: [
        {
          artistId: "artist_existing",
          displayName: "The Artist",
          role: "primary",
        },
      ],
      labelId: "reference_label",
      productTypeId: "reference_product_type",
      references: [
        {
          kind: "genre",
          referenceValueId: "reference_genre",
        },
      ],
      releaseDate: "2026-08-01",
      releaseDatePrecision: "month",
      releaseYear: 2026,
    })
  })

  it("builds an accessible merchandise size/color matrix", () => {
    let values = applyCatalogCreationKind(
      createCatalogCreationDefaults(),
      "merch",
    )
    values = {
      ...values,
      merchandiseType: "Shirt",
      sizeGuide: "S: 18 in wide\nM: 20 in wide",
      title: "Logo shirt",
      offerings: [
        {
          ...values.offerings[0]!,
          color: "Black",
          priceUsd: "20",
          size: "S",
          title: "Small / Black",
        },
        {
          ...values.offerings[0]!,
          color: "Black",
          id: crypto.randomUUID(),
          priceUsd: "20",
          size: "M",
          title: "Medium / Black",
        },
      ],
    }

    const request = buildCatalogProductCreateRequest(
      values,
      "00000000-0000-4000-8000-000000000001",
      [],
      vocabulary,
    )

    expect(request.options).toEqual([
      { title: "Size", values: ["S", "M"] },
      { title: "Color", values: ["Black"] },
    ])
    expect(request.variants.map((variant) => variant.options)).toEqual([
      { Color: "Black", Size: "S" },
      { Color: "Black", Size: "M" },
    ])
    expect(request.profile).toMatchObject({
      merchDetails: { sizeGuide: "S: 18 in wide\nM: 20 in wide" },
      references: [
        {
          kind: "merch_type",
          referenceValueId: "reference_merch_type",
        },
      ],
    })
  })

  it("applies merchandise templates without copying unsafe variant state", () => {
    const values = createCatalogCreationDefaults("merch")
    values.offerings[0] = {
      ...values.offerings[0]!,
      availabilityPolicy: "backorder",
      color: "Black",
      priceUsd: "24.99",
      sku: "SHIRT-BLACK",
      stockQuantity: "37",
    }
    let nextId = 0

    const offerings = createCatalogCreationMerchandiseOfferings(
      "apparel_standard",
      values.offerings,
      () => `offering_${++nextId}`,
    )

    expect(offerings.map(({ id, size, title }) => ({ id, size, title }))).toEqual([
      { id: "offering_1", size: "S", title: "S" },
      { id: "offering_2", size: "M", title: "M" },
      { id: "offering_3", size: "L", title: "L" },
      { id: "offering_4", size: "XL", title: "XL" },
      { id: "offering_5", size: "2XL", title: "2XL" },
    ])
    expect(offerings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          availabilityPolicy: "inventory_only",
          color: "",
          priceUsd: "24.99",
          sku: "",
          stockQuantity: "0",
        }),
      ]),
    )
  })

  it("maps every fixed-bundle component to stable offering keys", () => {
    let values = applyCatalogCreationKind(
      createCatalogCreationDefaults(),
      "fixed_bundle",
    )
    const first = values.offerings[0]!
    const second = {
      ...first,
      format: "LP",
      id: crypto.randomUUID(),
      title: "LP bundle",
    }
    values = {
      ...values,
      title: "Format bundle",
      offerings: [{ ...first, title: "CD bundle" }, second],
      bundleComponents: [
        {
          id: crypto.randomUUID(),
          offeringIds: [first.id, second.id],
          productId: "component_product",
          quantity: "2",
          variantId: "component_cd",
        },
      ],
    }

    const request = buildCatalogProductCreateRequest(
      values,
      "00000000-0000-4000-8000-000000000001",
      choices,
    )

    expect(request.variants.every((variant) => variant.stockQuantity === undefined)).toBe(
      true,
    )
    expect(request.bundle?.components).toEqual([
      expect.objectContaining({
        bundleVariantKeys: ["cd-bundle", "lp-bundle"],
        componentProductId: "component_product",
        componentVariantId: "component_cd",
        quantity: 2,
      }),
    ])
  })

  it("rejects duplicate offerings, incomplete bundle maps, and stale choices", () => {
    const music = createCatalogCreationDefaults()
    music.title = "Record"
    music.artistName = "Artist"
    music.offerings.push({
      ...music.offerings[0]!,
      id: crypto.randomUUID(),
    })
    expect(catalogCreationFormSchema.safeParse(music).success).toBe(false)

    const fixed = applyCatalogCreationKind(music, "fixed_bundle")
    expect(validateCatalogCreationStep(fixed, 2)).toContain(
      "Add at least one included product.",
    )
    fixed.title = "Bundle"
    fixed.bundleComponents = [
      {
        id: crypto.randomUUID(),
        offeringIds: [fixed.offerings[0]!.id],
        productId: "missing_product",
        quantity: "1",
        variantId: "missing_variant",
      },
    ]
    expect(() =>
      buildCatalogProductCreateRequest(
        fixed,
        "00000000-0000-4000-8000-000000000001",
        choices,
      ),
    ).toThrow("no longer available")

    const merchPreorder = createCatalogCreationDefaults("merch")
    merchPreorder.merchandiseType = "Shirt"
    merchPreorder.offerings[0]!.availabilityPolicy = "preorder"
    expect(validateCatalogCreationStep(merchPreorder, 2)).toContain(
      "Preorders are available only for music releases in this workflow.",
    )
  })

  it("round-trips valid drafts and expires or rejects unsafe stored state", () => {
    const now = Date.UTC(2026, 7, 1)
    const values = createCatalogCreationDefaults()
    values.title = "Saved draft"
    values.artistName = "Artist"
    const serialized = serializeCatalogCreationDraft(values, 2, now)

    expect(parseCatalogCreationDraft(serialized, now)).toMatchObject({
      step: 2,
      values: { title: "Saved draft" },
    })
    expect(
      parseCatalogCreationDraft(serialized, now + catalogCreationDraftTtlMs),
    ).toBeNull()
    expect(parseCatalogCreationDraft("not json", now)).toBeNull()
  })

  it("migrates version-one browser drafts without losing release dates", () => {
    const now = Date.UTC(2026, 7, 1)
    const values = createCatalogCreationDefaults()
    values.title = "Legacy saved draft"
    values.artistName = "Artist"
    values.releaseDate = "2026-08-01"
    const {
      artistId: _artistId,
      genreId: _genreId,
      labelId: _labelId,
      merchandiseType: _merchandiseType,
      merchandiseTypeId: _merchandiseTypeId,
      productTypeId: _productTypeId,
      releaseDatePrecision: _releaseDatePrecision,
      sizeGuide: _sizeGuide,
      offerings,
      ...legacyValues
    } = values
    const legacyOfferings = offerings.map(
      ({ availabilityPolicy: _availabilityPolicy, ...offering }) => ({
        ...offering,
        allowBackorder: false,
      }),
    )

    expect(
      parseCatalogCreationDraft(
        JSON.stringify({
          expiresAt: now + catalogCreationDraftTtlMs,
          step: 1,
          values: { ...legacyValues, offerings: legacyOfferings },
          version: 1,
        }),
        now,
      ),
    ).toMatchObject({
      step: 1,
      values: {
        artistId: "",
        offerings: [expect.objectContaining({ availabilityPolicy: "inventory_only" })],
        releaseDate: "2026-08-01",
        releaseDatePrecision: "day",
        sizeGuide: "",
        title: "Legacy saved draft",
      },
    })
  })

  it("migrates version-two backorder drafts to the selling policy", () => {
    const now = Date.UTC(2026, 7, 1)
    const values = createCatalogCreationDefaults()
    const versionTwoOfferings = values.offerings.map(
      ({ availabilityPolicy: _availabilityPolicy, ...offering }) => ({
        ...offering,
        allowBackorder: true,
      }),
    )

    expect(
      parseCatalogCreationDraft(
        JSON.stringify({
          expiresAt: now + catalogCreationDraftTtlMs,
          step: 2,
          values: { ...values, offerings: versionTwoOfferings },
          version: 2,
        }),
        now,
      ),
    ).toMatchObject({
      step: 2,
      values: {
        offerings: [expect.objectContaining({ availabilityPolicy: "backorder" })],
      },
    })
  })

  it("migrates version-three drafts to an empty managed gallery", () => {
    const now = Date.UTC(2026, 7, 1)
    const { media: _media, ...versionThreeValues } =
      createCatalogCreationDefaults()

    expect(
      parseCatalogCreationDraft(
        JSON.stringify({
          expiresAt: now + catalogCreationDraftTtlMs,
          step: 3,
          values: versionThreeValues,
          version: 3,
        }),
        now,
      ),
    ).toMatchObject({
      step: 3,
      values: { media: [] },
    })
  })
})
