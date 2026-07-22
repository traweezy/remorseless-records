import productSearchTransformer, {
  buildSearchDocument,
} from "./product-transformer"

describe("buildSearchDocument", () => {
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
            prices: [{ amount: 2500, currency_code: "usd" }],
          },
          {
            id: "var_cd",
            title: "CD",
            sku: "CD-1",
            manage_inventory: true,
            inventory_quantity: 0,
            prices: [{ amount: 1200, currency_code: "usd" }],
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
      price_min: 1200,
      price_max: 2500,
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
          prices: [{ amount: 900, currency_code: "usd" }],
        },
      ],
    })

    expect(document.artist_names).toEqual(["Fallback Artist"])
    expect(document.genres).toEqual(["Grind"])
    expect(document.product_type).toBe("release")
    expect(document.label).toBe("Remorseless Records")
    expect(document.price_amount).toBe(900)
    expect(document.stock_status).toBe("sold_out")
    expect(document.availability_states).toEqual(["sold_out"])
  })

  it("loads linked inventory before deriving search stock state", async () => {
    const query = {
      graph: jest.fn().mockResolvedValue({
        data: [
          {
            variant_id: "var_available",
            required_quantity: 1,
            inventory: {
              location_levels: [{ location_id: "loc_1", available_quantity: 12 }],
            },
          },
          {
            variant_id: "var_sold_out",
            required_quantity: 1,
            inventory: {
              location_levels: [{ location_id: "loc_1", available_quantity: 0 }],
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
          prices: [{ amount: 1200, currency_code: "usd" }],
        },
        {
          id: "var_sold_out",
          title: "Cassette",
          manage_inventory: true,
          prices: [{ amount: 900, currency_code: "usd" }],
        },
      ],
    }

    const document = await productSearchTransformer(
      product,
      async (value) => value,
      {
        container: {
          hasRegistration: (key) => key !== "catalog",
          resolve: () => query,
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
          prices: [{ amount: 1200, currency_code: "usd" }],
        },
      ],
    })

    expect(document.stock_status).toBe("unknown")
    expect(document.inventory_quantity).toBeNull()
  })
})
