import {
  readCatalogBundleComponents,
  readCatalogBundleInventoryProvenance,
  readCatalogBundleProfiles,
  readCatalogCreatedProductId,
  readCatalogCreatedProductVariants,
  readCatalogEntityIds,
  readCatalogOrphanMediaPage,
  readCatalogProductVariantIds,
  readCatalogServiceIds,
  readCatalogStoreDefaults,
  readCatalogStoreBundleProfiles,
  readCatalogVariantInventoryLinks,
  readCatalogVariantOwnerships,
} from "./persistence-contracts"

const invalidBoundary =
  "The catalog persistence boundary returned invalid structured data."

describe("catalog persistence contracts", () => {
  it("accepts canonical entity identifiers and preserves missing entities", () => {
    expect(
      readCatalogEntityIds({ data: [{ id: "prod_01" }] }, ["prod_01"])
    ).toEqual(["prod_01"])
    expect(readCatalogEntityIds({ data: [] }, ["prod_missing"])).toEqual([])
  })

  it.each([
    undefined,
    { data: [false] },
    { data: [{ id: " prod_01" }] },
    { data: [{ id: "prod_01" }, { id: "prod_01" }] },
    { data: [{ id: "prod_unexpected" }] },
  ])("rejects malformed, duplicate, or unexpected entity rows", (value) => {
    expect(() => readCatalogEntityIds(value, ["prod_01"])).toThrow(
      invalidBoundary
    )
  })

  it("requires authoritative and consistent variant ownership", () => {
    expect(
      readCatalogVariantOwnerships(
        {
          data: [
            {
              id: "variant_01",
              product_id: "prod_01",
              product: { id: "prod_01" },
            },
          ],
        },
        ["variant_01"]
      )
    ).toEqual([{ id: "variant_01", productId: "prod_01" }])

    expect(() =>
      readCatalogVariantOwnerships(
        {
          data: [
            {
              id: "variant_01",
              product_id: "prod_01",
              product: { id: "prod_other" },
            },
          ],
        },
        ["variant_01"]
      )
    ).toThrow(invalidBoundary)
    expect(() =>
      readCatalogVariantOwnerships(
        { data: [{ id: "variant_01", product: null }] },
        ["variant_01"]
      )
    ).toThrow(invalidBoundary)
  })

  it("rejects ambiguous inventory links and invalid persisted quantities", () => {
    const valid = {
      data: [
        {
          inventory_item_id: "iitem_01",
          required_quantity: "2",
          variant_id: "variant_01",
        },
      ],
    }
    expect(
      readCatalogVariantInventoryLinks(valid, ["variant_01"], {
        requireQuantity: true,
      })
    ).toEqual([
      {
        inventoryItemId: "iitem_01",
        requiredQuantity: 2,
        variantId: "variant_01",
      },
    ])

    expect(() =>
      readCatalogVariantInventoryLinks(
        {
          data: [
            {
              inventory_item_id: "iitem_01",
              required_quantity: 0,
              variant_id: "variant_01",
            },
          ],
        },
        ["variant_01"],
        { requireQuantity: true }
      )
    ).toThrow(invalidBoundary)
    expect(() =>
      readCatalogVariantInventoryLinks(
        {
          data: [
            {
              inventory_item_id: "iitem_01",
              variant_id: "variant_01",
            },
            {
              inventory_item_id: "iitem_01",
              variant_id: "variant_01",
            },
          ],
        },
        ["variant_01"]
      )
    ).toThrow(invalidBoundary)
  })

  it("requires exact product and variant graph shapes", () => {
    expect(
      readCatalogProductVariantIds(
        {
          data: [
            {
              id: "prod_01",
              variants: [{ id: "variant_01" }, { id: "variant_02" }],
            },
          ],
        },
        "prod_01"
      )
    ).toEqual(["variant_01", "variant_02"])
    expect(readCatalogProductVariantIds({ data: [] }, "prod_missing")).toEqual(
      []
    )
    expect(() =>
      readCatalogProductVariantIds(
        { data: [{ id: "prod_01", variants: [null] }] },
        "prod_01"
      )
    ).toThrow(invalidBoundary)
  })

  it("requires an exact create acknowledgement and complete stable keys", () => {
    expect(readCatalogCreatedProductId([{ id: "prod_01" }])).toBe("prod_01")
    expect(() => readCatalogCreatedProductId([])).toThrow(invalidBoundary)
    expect(() =>
      readCatalogCreatedProductId([{ id: "prod_01" }, { id: "prod_02" }])
    ).toThrow(invalidBoundary)

    expect(
      readCatalogCreatedProductVariants(
        {
          data: [
            {
              id: "prod_01",
              variants: [
                { id: "variant_01", metadata: { creation_key: "cd" } },
                { id: "variant_02", metadata: { creation_key: "lp" } },
              ],
            },
          ],
        },
        "prod_01",
        ["cd", "lp"],
        "creation_key"
      )
    ).toEqual([
      { creationKey: "cd", id: "variant_01" },
      { creationKey: "lp", id: "variant_02" },
    ])
    expect(() =>
      readCatalogCreatedProductVariants(
        {
          data: [
            {
              id: "prod_01",
              variants: [
                { id: "variant_01", metadata: { creation_key: "cd" } },
                { id: "variant_02", metadata: { creation_key: "cd" } },
              ],
            },
          ],
        },
        "prod_01",
        ["cd", "lp"],
        "creation_key"
      )
    ).toThrow(invalidBoundary)
  })

  it("validates service defaults without silently dropping malformed rows", () => {
    expect(readCatalogServiceIds([{ id: "sp_01" }])).toEqual(["sp_01"])
    expect(
      readCatalogStoreDefaults([
        { id: "store_01", default_sales_channel_id: "sc_01" },
        { id: "store_02", default_sales_channel_id: null },
      ])
    ).toEqual([
      { defaultSalesChannelId: "sc_01", id: "store_01" },
      { defaultSalesChannelId: null, id: "store_02" },
    ])
    expect(() =>
      readCatalogStoreDefaults([
        { id: "store_01", default_sales_channel_id: false },
      ])
    ).toThrow(invalidBoundary)
  })

  it("validates bundle profile and component table invariants", () => {
    expect(
      readCatalogBundleProfiles(
        [
          {
            id: "cbundle_01",
            inventory_mode: "component_derived",
            is_active: true,
            product_id: "prod_01",
          },
        ],
        "prod_01"
      )
    ).toEqual([
      {
        id: "cbundle_01",
        inventory_mode: "component_derived",
        is_active: true,
        product_id: "prod_01",
      },
    ])
    expect(() =>
      readCatalogBundleProfiles(
        [
          {
            id: "cbundle_01",
            inventory_mode: "component_derived",
            is_active: true,
            product_id: "prod_other",
          },
        ],
        "prod_01"
      )
    ).toThrow(invalidBoundary)

    expect(
      readCatalogStoreBundleProfiles(
        [
          {
            bundle_type: "selectable",
            display_title: "Build Your Bundle",
            id: "cbundle_01",
            is_active: true,
            product_id: "prod_01",
          },
        ],
        "prod_01"
      )
    ).toEqual([
      {
        bundle_type: "selectable",
        display_title: "Build Your Bundle",
        id: "cbundle_01",
        is_active: true,
        product_id: "prod_01",
      },
    ])
    expect(() =>
      readCatalogStoreBundleProfiles(
        [
          {
            bundle_type: "broken",
            display_title: null,
            id: "cbundle_01",
            is_active: true,
            product_id: "prod_01",
          },
        ],
        "prod_01"
      )
    ).toThrow(invalidBoundary)

    const component = {
      bundle_profile_id: "cbundle_01",
      component_inventory_item_id: "iitem_01",
      component_product_id: "prod_component",
      component_variant_id: "variant_component",
      id: "cbcomp_01",
      is_required: true,
      metadata: {},
      quantity: 2,
      sku: null,
      sort_order: 0,
      title: null,
      variant_title: null,
    }
    expect(readCatalogBundleComponents([component], "cbundle_01")).toEqual([
      component,
    ])
    expect(() =>
      readCatalogBundleComponents(
        [{ ...component, quantity: "broken" }],
        "cbundle_01"
      )
    ).toThrow(invalidBoundary)
    expect(() =>
      readCatalogBundleComponents(
        [{ ...component, metadata: [] }],
        "cbundle_01"
      )
    ).toThrow(invalidBoundary)
  })

  it("validates bundle inventory provenance ownership and quantities", () => {
    const link = {
      bundle_profile_id: "cbundle_01",
      bundle_variant_id: "variant_bundle",
      id: "cbilink_01",
      inventory_item_id: "iitem_01",
      metadata: {},
      required_quantity: 2,
    }
    expect(readCatalogBundleInventoryProvenance([link], "cbundle_01")).toEqual([
      link,
    ])
    expect(() =>
      readCatalogBundleInventoryProvenance(
        [{ ...link, bundle_profile_id: "cbundle_other" }],
        "cbundle_01"
      )
    ).toThrow(invalidBoundary)
    expect(() =>
      readCatalogBundleInventoryProvenance(
        [link, { ...link, id: "cbilink_02" }],
        "cbundle_01"
      )
    ).toThrow(invalidBoundary)
    expect(() =>
      readCatalogBundleInventoryProvenance(
        [{ ...link, required_quantity: 0 }],
        "cbundle_01"
      )
    ).toThrow(invalidBoundary)
  })

  it("validates orphan counts, row identities, and page consistency", () => {
    expect(
      readCatalogOrphanMediaPage(
        [{ count: "2" }],
        [{ id: "cmedia_01" }, { id: "cmedia_02" }]
      )
    ).toEqual({
      count: 2,
      rows: [{ id: "cmedia_01" }, { id: "cmedia_02" }],
    })
    expect(() =>
      readCatalogOrphanMediaPage([{ count: "not-a-count" }], [])
    ).toThrow(invalidBoundary)
    expect(() =>
      readCatalogOrphanMediaPage(
        [{ count: 1 }],
        [{ id: "cmedia_01" }, { id: "cmedia_02" }]
      )
    ).toThrow(invalidBoundary)
    expect(() =>
      readCatalogOrphanMediaPage(
        [{ count: 2 }],
        [{ id: "cmedia_01" }, { id: "cmedia_01" }]
      )
    ).toThrow(invalidBoundary)
  })
})
