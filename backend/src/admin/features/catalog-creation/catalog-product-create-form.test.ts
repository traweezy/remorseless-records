import {
  applyCatalogCreationKind,
  buildCatalogProductCreateRequest,
  catalogCreationDraftTtlMs,
  catalogCreationFormSchema,
  createCatalogCreationDefaults,
  parseCatalogCreationDraft,
  resolveCatalogCreationHandle,
  serializeCatalogCreationDraft,
  validateCatalogCreationStep,
  type CatalogCreationProductChoice,
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

  it("builds an accessible merchandise size/color matrix", () => {
    let values = applyCatalogCreationKind(
      createCatalogCreationDefaults(),
      "merch",
    )
    values = {
      ...values,
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
    )

    expect(request.options).toEqual([
      { title: "Size", values: ["S", "M"] },
      { title: "Color", values: ["Black"] },
    ])
    expect(request.variants.map((variant) => variant.options)).toEqual([
      { Color: "Black", Size: "S" },
      { Color: "Black", Size: "M" },
    ])
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
})
