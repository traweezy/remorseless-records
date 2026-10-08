import type { ProductDTO } from "@medusajs/framework/types"

import productSearchTransformer, {
  buildSearchDocument,
} from "./product-transformer"

describe("buildSearchDocument", () => {
  it("projects finite native ProductDTO Date timestamps without guessing dates", () => {
    const timestamps: Pick<ProductDTO, "created_at" | "updated_at"> = {
      created_at: new Date("2026-10-03T23:26:56.472Z"),
      updated_at: new Date("2026-10-07T12:27:10.170Z"),
    }
    const document = buildSearchDocument({
      id: "prod_native_dates",
      ...timestamps,
    })

    expect(document.created_at).toBe("2026-10-03T23:26:56.472Z")
    expect(document.updated_at).toBe("2026-10-07T12:27:10.170Z")
  })

  it("retains timestamp aliases and nullish native field precedence", () => {
    const document = buildSearchDocument({
      id: "prod_date_aliases",
      created_at: null,
      createdAt: new Date("2026-10-03T23:26:56.472Z"),
      updated_at: undefined,
      updatedAt: new Date("2026-10-07T12:27:10.170Z"),
    })
    expect(document.created_at).toBe("2026-10-03T23:26:56.472Z")
    expect(document.updated_at).toBe("2026-10-07T12:27:10.170Z")

    const invalidNativeDates = buildSearchDocument({
      id: "prod_invalid_native_dates",
      created_at: new Date(Number.NaN),
      createdAt: new Date("2026-10-03T23:26:56.472Z"),
      updated_at: new Date(Number.NaN),
      updatedAt: new Date("2026-10-07T12:27:10.170Z"),
    })
    expect(invalidNativeDates.created_at).toBeNull()
    expect(invalidNativeDates.updated_at).toBeNull()
  })

  it.each([
    ["2026-10-03T23:26:56.472Z", "2026-10-03T23:26:56.472Z"],
    [" 2026-10-03T19:26:56.472-04:00 ", "2026-10-03T23:26:56.472Z"],
    [2026, "2026-01-01T00:00:00.000Z"],
  ])(
    "preserves existing string and numeric timestamp parsing for %p",
    (value, expected) => {
      const document = buildSearchDocument({
        id: "prod_existing_date_values",
        created_at: value,
        updated_at: value,
      })
      expect(document.created_at).toBe(expected)
      expect(document.updated_at).toBe(expected)
    }
  )

  it.each([new Date(Number.NaN), "not-a-date", " ", null, undefined, true])(
    "does not invent timestamps for an invalid or missing value %p",
    (value) => {
      const document = buildSearchDocument({
        id: "prod_missing_dates",
        created_at: value,
        updated_at: value,
      })
      expect(document.created_at).toBeNull()
      expect(document.updated_at).toBeNull()
    }
  )

  it("rejects arbitrary date-like objects without invoking their methods", () => {
    const toISOString = jest.fn(() => "2026-10-03T23:26:56.472Z")
    const dateValueOf = jest.fn(() => Date.parse("2026-10-03T23:26:56.472Z"))
    const document = buildSearchDocument({
      id: "prod_date_like_objects",
      created_at: { toISOString, valueOf: dateValueOf },
      updated_at: { toISOString, valueOf: dateValueOf },
    })
    expect(document.created_at).toBeNull()
    expect(document.updated_at).toBeNull()
    expect(toISOString).not.toHaveBeenCalled()
    expect(dateValueOf).not.toHaveBeenCalled()
  })

  it("keeps catalog source creation precedence and falls back only when invalid", () => {
    const product = {
      id: "prod_source_dates",
      created_at: new Date("2026-10-03T23:26:56.472Z"),
    }
    const authoredDate = buildSearchDocument(product, {
      profile: {
        metadata: { source_created_at: "2025-12-15T10:00:00.000Z" },
      },
    })
    expect(authoredDate.created_at).toBe("2025-12-15T10:00:00.000Z")

    const invalidSourceDate = buildSearchDocument(product, {
      profile: { metadata: { source_created_at: "not-a-date" } },
    })
    expect(invalidSourceDate.created_at).toBe("2026-10-03T23:26:56.472Z")
  })

  it("projects native release and preorder Date values through the shared converter", () => {
    const product = {
      id: "prod_release_dates",
      variants: [{ id: "var_release_dates" }],
    }
    const document = buildSearchDocument(product, {
      profile: { release_date: new Date("2026-10-03T00:00:00.000Z") },
      variantProfiles: [
        {
          variant_id: "var_release_dates",
          preorder_release_date: new Date("2026-10-07T00:00:00.000Z"),
        },
      ],
    })
    expect(document.release_date).toBe("2026-10-03T00:00:00.000Z")
    expect(document.variants[0]?.preorder_release_date).toBe(
      "2026-10-07T00:00:00.000Z"
    )

    const invalidDates = buildSearchDocument(product, {
      profile: { release_date: new Date(Number.NaN) },
      variantProfiles: [
        {
          variant_id: "var_release_dates",
          preorder_release_date: new Date(Number.NaN),
        },
      ],
    })
    expect(invalidDates.release_date).toBeNull()
    expect(invalidDates.variants[0]?.preorder_release_date).toBeNull()
  })

  it("indexes canonical bundle formats without changing authored option labels", () => {
    const document = buildSearchDocument({
      id: "prod_mystery",
      title: "Mystery Bundle",
      metadata: { product_type: "mystery-bundle" },
      variants: [
        { id: "var_cd_bundle", title: "3x CDs" },
        { id: "var_cassette_bundle", title: "3x Cassettes" },
      ],
    })

    expect(document.formats).toEqual([
      "3x CDs",
      "3x Cassettes",
      "CD",
      "Cassette",
    ])
    expect(document.variant_titles).toEqual(["3x CDs", "3x Cassettes"])
    expect(document.variants.map((variant) => variant.title)).toEqual([
      "3x CDs",
      "3x Cassettes",
    ])
  })

  it.each([
    { format: "Cassette" },
    { packaging: "Black shell" },
    { formats: ["Cassette"] },
  ])(
    "retains readable legacy formats when the variant title is an album",
    (metadata) => {
      const document = buildSearchDocument({
        id: "prod_legacy_cassette",
        title: "Relics of Ancient Love",
        metadata,
        variants: [
          {
            id: "var_legacy_cassette",
            title: "Tears of Fire - Relics of Ancient Love",
          },
        ],
      })

      expect(document.formats).toEqual([
        "Tears of Fire - Relics of Ancient Love",
        "Cassette",
      ])
      expect(document.variant_titles).toEqual([
        "Tears of Fire - Relics of Ancient Love",
      ])
    }
  )

  it.each(["CD", "Digital", "Box"])(
    "keeps explicit native format %s ahead of legacy metadata",
    (format) => {
      const document = buildSearchDocument(
        {
          id: "prod_native_format",
          metadata: { format: "Cassette", formats: ["DVD"] },
          variants: [{ id: "var_native_format", title: "Limited edition" }],
        },
        {
          variantProfiles: [
            { variant_id: "var_native_format", format_label: format },
          ],
        }
      )

      expect(document.formats).toEqual([format])
      expect(document.variant_titles).toEqual(["Limited edition"])
    }
  )

  it("does not infer media formats from apparel sizes or unrelated words", () => {
    const document = buildSearchDocument({
      id: "prod_apparel",
      title: "Label shirt",
      variants: [
        { id: "var_size", title: "12" },
        { id: "var_text", title: "Eclipse" },
      ],
    })

    expect(document.formats).toEqual(["12", "Eclipse"])
  })

  it("builds a catalog-aware search document from product and catalog facts", () => {
    const document = buildSearchDocument(
      {
        id: "prod_1",
        handle: "artist-album",
        title: "Artist - Album",
        subtitle: "Legacy Artist",
        description: "Fallback description",
        thumbnail: "https://cdn.example.com/fallback.jpg",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
        metadata: {
          catalog_import: {
            artists: ["Imported Artist"],
            genres: ["Doom Metal"],
            utility_tags: ["Limited"],
            label: "Imported Label",
            product_type: "release",
            release_date: "2026-02-01",
            release_year: 2026,
            description_html: "<p>Imported <strong>description</strong></p>",
          },
        },
        collection: {
          id: "col_1",
          title: "Remorseless Records",
          handle: "remorseless-records",
        },
        categories: [
          { handle: "metal", name: "Metal" },
          {
            handle: "doom",
            name: "Doom",
            parent_category: { handle: "metal", name: "Metal" },
          },
          { handle: "music", name: "Music" },
        ],
        options: [
          {
            title: "Format",
            values: [{ value: "LP" }, { value: "CD" }],
          },
        ],
        variants: [
          {
            id: "var_lp",
            title: "LP",
            sku: "LP-1",
            manage_inventory: true,
            inventory_quantity: 2,
            prices: [{ amount: 25, currency_code: "usd" }],
          },
          {
            id: "var_cd",
            title: "CD",
            sku: "CD-1",
            manage_inventory: true,
            inventory_quantity: 0,
            prices: [{ amount: 12, currency_code: "usd" }],
          },
        ],
      },
      {
        profile: {
          id: "cprof_1",
          product_id: "prod_1",
          release_title: "Catalog Album",
          label_id: "label_1",
          product_type_id: "ptype_1",
          release_date: "2026-03-01T00:00:00.000Z",
          release_year: 2026,
          description_html: "<p>Catalog <em>description</em></p>",
          search_keywords: ["bleak", "funeral"],
          metadata: {
            source_created_at: "2025-12-15T10:00:00.000Z",
          },
        },
        artists: [
          {
            artist_id: "artist_1",
            display_name: "Catalog Artist",
            sort_order: 0,
          },
        ],
        references: [
          {
            reference_value_id: "genre_1",
            kind: "genre",
            sort_order: 0,
          },
          {
            reference_value_id: "tag_1",
            kind: "utility_tag",
            sort_order: 0,
          },
        ],
        referenceValues: [
          {
            id: "label_1",
            kind: "label",
            label: "Catalog Label",
            value: "catalog-label",
          },
          {
            id: "ptype_1",
            kind: "product_type",
            label: "Release",
            value: "release",
          },
          {
            id: "genre_1",
            kind: "genre",
            label: "Death Metal",
            value: "death-metal",
          },
          {
            id: "tag_1",
            kind: "utility_tag",
            label: "Staff Pick",
            value: "staff-pick",
          },
          {
            id: "format_vinyl",
            kind: "format",
            label: "Vinyl",
            value: "vinyl",
          },
          {
            id: "format_detail_black",
            kind: "format_detail",
            label: "Black",
            value: "black",
          },
        ],
        variantProfiles: [
          {
            variant_id: "var_lp",
            format_id: "format_vinyl",
            format_detail_id: "format_detail_black",
            display_label: "Vinyl - Black",
            availability_status: "preorder",
            preorder_allowed: true,
            preorder_release_date: "2026-03-01T00:00:00.000Z",
          },
          {
            variant_id: "var_cd",
            format_label: "CD",
            display_label: "CD",
            availability_status: "backorder",
            backorder_allowed: true,
            backorder_note: "More copies expected",
          },
        ],
        bundleProfile: {
          bundle_type: "fixed",
          display_title: "Label bundle",
        },
        bundleComponents: [
          {
            component_product_id: "prod_component",
            title: "Included Album",
          },
        ],
        mediaItems: [
          {
            media_asset_id: "media_1",
            role: "primary",
            sort_order: 0,
            is_primary: true,
          },
        ],
        mediaAssets: [
          {
            id: "media_1",
            source_url: "https://cdn.example.com/catalog.jpg",
            alt_text: "Album cover",
            width: 1000,
            height: 1000,
          },
        ],
        shelves: [
          {
            handle: "staff-picks",
            title: "Staff Picks",
            show_ribbon: true,
            ribbon_label: "Staff Pick",
            ribbon_priority: 10,
            is_active: true,
          },
        ],
      }
    )

    expect(document).toMatchObject({
      id: "prod_1",
      release_title: "Catalog Album",
      artist: "Catalog Artist / Imported Artist / Legacy Artist",
      artist_sort: "catalog artist",
      artist_names: ["Catalog Artist", "Imported Artist", "Legacy Artist"],
      artist_ids: ["artist_1"],
      label: "Catalog Label",
      genres: ["Death Metal", "Doom Metal", "Doom"],
      utility_tags: ["Staff Pick", "Limited"],
      product_type: "release",
      product_type_label: "Release",
      format: "LP",
      formats: ["LP", "CD", "Vinyl"],
      format_details: ["Black"],
      price_min: 25,
      price_max: 25,
      stock_status: "low_stock",
      availability_states: expect.arrayContaining([
        "low_stock",
        "sold_out",
        "preorder",
        "backorder",
      ]),
      thumbnail: "https://cdn.example.com/catalog.jpg",
      bundle_type: "fixed",
      bundle_summary: "Label bundle",
      bundle_component_count: 1,
      shelf_handles: ["staff-picks"],
      ribbon_label: "Staff Pick",
      ribbon_priority: 10,
      created_at: "2025-12-15T10:00:00.000Z",
    })
    expect(document.description_text).toBe("Catalog description")
    expect(document.variants).toHaveLength(2)
  })

  it("falls back to import metadata when catalog facts are unavailable", () => {
    const document = buildSearchDocument({
      id: "prod_2",
      handle: "fallback",
      title: "Fallback Artist - Demo",
      metadata: {
        catalog_import: {
          artists: ["Fallback Artist"],
          genres: ["Grind"],
          product_type: "release",
          label: "Remorseless Records",
          utility_tags: ["Imported"],
        },
      },
      variants: [
        {
          id: "var_tape",
          title: "Cassette",
          manage_inventory: true,
          inventory_quantity: 0,
          prices: [{ amount: 9, currency_code: "usd" }],
        },
      ],
    })

    expect(document.artist_names).toEqual(["Fallback Artist"])
    expect(document.artist_sort).toBe("fallback artist")
    expect(document.genres).toEqual(["Grind"])
    expect(document.product_type).toBe("release")
    expect(document.label).toBe("Remorseless Records")
    expect(document.price_amount).toBe(9)
    expect(document.price_min).toBeNull()
    expect(document.price_max).toBeNull()
    expect(document.stock_status).toBe("sold_out")
    expect(document.availability_states).toEqual(["sold_out"])
  })

  it("sanitizes malformed executable description markup before indexing", () => {
    const document = buildSearchDocument({
      id: "prod_adversarial_description",
      handle: "adversarial-description",
      title: "Adversarial description",
      metadata: {
        catalog_import: {
          description_html:
            '<p>Safe &amp; sound</p><script>alert("indexed")</script ><p>&lt;strong&gt;literal&lt;/strong&gt;</p>',
        },
      },
      variants: [],
    })

    expect(document.description_text).toBe(
      "Safe &amp; sound&lt;strong&gt;literal&lt;/strong&gt;"
    )
    expect(document.description_text).not.toMatch(/alert|script/i)
    expect(document.description_html).toBe(
      "<p>Safe &amp; sound</p><p>&lt;strong&gt;literal&lt;/strong&gt;</p>"
    )
  })

  it("uses five as the verified low-stock threshold and hides import placeholders", () => {
    const document = buildSearchDocument({
      id: "prod_stock_threshold",
      handle: "stock-threshold",
      title: "Stock threshold",
      variants: [
        {
          id: "var_verified",
          title: "Vinyl",
          manage_inventory: true,
          inventory_quantity: 5,
          metadata: { inventory_count_status: "verified" },
          prices: [{ amount: 20, currency_code: "usd" }],
        },
        {
          id: "var_imported",
          title: "CD",
          manage_inventory: true,
          inventory_quantity: 2,
          metadata: {
            source_low_inventory: true,
            seed_inventory_quantity: 2,
          },
          prices: [{ amount: 10, currency_code: "usd" }],
        },
      ],
    })

    expect(document.variants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "var_verified",
          stock_status: "low_stock",
          low_stock_badge_eligible: true,
        }),
        expect.objectContaining({
          id: "var_imported",
          stock_status: "low_stock",
          low_stock_badge_eligible: false,
        }),
      ])
    )
    expect(document.low_stock_badge_eligible).toBe(true)
  })

  it("reads imported stock confidence from catalog variant profiles", () => {
    const document = buildSearchDocument(
      {
        id: "prod_profile_stock",
        handle: "profile-stock",
        title: "Profile stock",
        variants: [
          {
            id: "var_profile_stock",
            title: "CD",
            manage_inventory: true,
            inventory_quantity: 2,
            prices: [{ amount: 10, currency_code: "usd" }],
          },
        ],
      },
      {
        variantProfiles: [
          {
            variant_id: "var_profile_stock",
            metadata: {
              source_low_inventory: true,
              seed_inventory_quantity: 2,
            },
          },
        ],
      }
    )

    expect(document.variants).toEqual([
      expect.objectContaining({
        id: "var_profile_stock",
        stock_status: "low_stock",
        low_stock_badge_eligible: false,
      }),
    ])
    expect(document.low_stock_badge_eligible).toBe(false)
  })

  it("loads linked inventory before deriving search stock state", async () => {
    const query = {
      graph: jest.fn().mockResolvedValue({
        data: [
          {
            variant_id: "var_available",
            required_quantity: 1,
            inventory: {
              location_levels: [
                { location_id: "loc_1", available_quantity: 12 },
              ],
            },
          },
          {
            variant_id: "var_sold_out",
            required_quantity: 1,
            inventory: {
              location_levels: [
                { location_id: "loc_1", available_quantity: 0 },
              ],
            },
          },
        ],
      }),
    }
    const product = {
      id: "prod_inventory",
      handle: "inventory-aware-product",
      title: "Inventory-aware product",
      variants: [
        {
          id: "var_available",
          title: "CD",
          manage_inventory: true,
          prices: [{ amount: 12, currency_code: "usd" }],
        },
        {
          id: "var_sold_out",
          title: "Cassette",
          manage_inventory: true,
          prices: [{ amount: 9, currency_code: "usd" }],
        },
      ],
    }

    const document = await productSearchTransformer(
      product,
      async (value) => value,
      {
        container: {
          hasRegistration: (key) => key !== "catalog",
          resolve: <T = unknown>() => query as T,
        },
      }
    )

    expect(query.graph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "product_variant_inventory_items",
        filters: { variant_id: ["var_available", "var_sold_out"] },
      }),
      expect.any(Object)
    )
    expect(document.stock_status).toBe("in_stock")
    expect(document.stock_statuses).toEqual(["in_stock", "sold_out"])
    expect(document.default_variant_id).toBe("var_available")
    expect(document.inventory_quantity).toBe(12)
  })

  it("does not treat missing managed inventory data as sold out", () => {
    const document = buildSearchDocument({
      id: "prod_unknown_inventory",
      handle: "unknown-inventory-product",
      title: "Unknown inventory product",
      variants: [
        {
          id: "var_unknown",
          title: "CD",
          manage_inventory: true,
          prices: [{ amount: 12, currency_code: "usd" }],
        },
      ],
    })

    expect(document.stock_status).toBe("unknown")
    expect(document.inventory_quantity).toBeNull()
  })
})
