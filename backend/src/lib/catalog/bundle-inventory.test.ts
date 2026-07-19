import {
  buildBundleVariantInventoryPlan,
  parseResolvedVariantMappings,
  type CatalogBundleComponentRecord,
} from "./bundle-inventory";

const component = (
  overrides: Partial<CatalogBundleComponentRecord> = {},
): CatalogBundleComponentRecord => ({
  quantity: 1,
  is_required: true,
  metadata: {},
  ...overrides,
});

const resolvedMapping = (input: {
  bundleVariantIds: string[];
  selectionMode?: "exact" | "any";
  variants: Array<{ variantId: string; inventoryItemId: string }>;
}) => ({
  resolved_variant_mappings: [
    {
      bundle_variant_ids: input.bundleVariantIds,
      selection_mode: input.selectionMode ?? "exact",
      component_variants: input.variants.map((variant) => ({
        variant_id: variant.variantId,
        inventory_item_id: variant.inventoryItemId,
      })),
    },
  ],
});

describe("bundle inventory planning", () => {
  it("maps different component formats to each bundle variant", () => {
    const components = [
      component({
        metadata: {
          resolved_variant_mappings: [
            {
              bundle_variant_ids: ["bundle-cd"],
              selection_mode: "exact",
              component_variants: [
                { variant_id: "release-cd", inventory_item_id: "item-cd" },
              ],
            },
            {
              bundle_variant_ids: ["bundle-lp"],
              selection_mode: "exact",
              component_variants: [
                { variant_id: "release-lp", inventory_item_id: "item-lp" },
              ],
            },
          ],
        },
      }),
    ];

    expect(
      buildBundleVariantInventoryPlan({
        bundleVariantIds: ["bundle-cd", "bundle-lp"],
        components,
      }),
    ).toEqual([
      {
        bundleVariantId: "bundle-cd",
        links: [{ inventoryItemId: "item-cd", requiredQuantity: 1 }],
        selectedAlternativeVariantIds: [],
      },
      {
        bundleVariantId: "bundle-lp",
        links: [{ inventoryItemId: "item-lp", requiredQuantity: 1 }],
        selectedAlternativeVariantIds: [],
      },
    ]);
  });

  it("selects the first alternative that can satisfy the requested quantity", () => {
    const components = [
      component({
        quantity: 2,
        metadata: resolvedMapping({
          bundleVariantIds: ["bundle"],
          selectionMode: "any",
          variants: [
            { variantId: "white", inventoryItemId: "white-item" },
            { variantId: "red", inventoryItemId: "red-item" },
          ],
        }),
      }),
    ];

    expect(
      buildBundleVariantInventoryPlan({
        bundleVariantIds: ["bundle"],
        components,
        availabilityByVariantId: { white: 3, red: 8 },
        requestedQuantityByBundleVariantId: { bundle: 2 },
      }),
    ).toEqual([
      {
        bundleVariantId: "bundle",
        links: [{ inventoryItemId: "red-item", requiredQuantity: 2 }],
        selectedAlternativeVariantIds: ["red"],
      },
    ]);
  });

  it("keeps the preferred alternative linked when every option is unavailable", () => {
    const components = [
      component({
        metadata: resolvedMapping({
          bundleVariantIds: ["bundle"],
          selectionMode: "any",
          variants: [
            { variantId: "white", inventoryItemId: "white-item" },
            { variantId: "red", inventoryItemId: "red-item" },
          ],
        }),
      }),
    ];

    expect(
      buildBundleVariantInventoryPlan({
        bundleVariantIds: ["bundle"],
        components,
        availabilityByVariantId: { white: 0, red: 0 },
      })[0],
    ).toEqual({
      bundleVariantId: "bundle",
      links: [{ inventoryItemId: "white-item", requiredQuantity: 1 }],
      selectedAlternativeVariantIds: ["white"],
    });
  });

  it("combines duplicate inventory requirements and ignores optional components", () => {
    const components = [
      component({
        quantity: 2,
        component_variant_id: "release",
        component_inventory_item_id: "shared-item",
      }),
      component({
        quantity: 3,
        component_variant_id: "release",
        component_inventory_item_id: "shared-item",
      }),
      component({
        is_required: false,
        component_variant_id: "bonus",
        component_inventory_item_id: "bonus-item",
      }),
    ];

    expect(
      buildBundleVariantInventoryPlan({
        bundleVariantIds: ["bundle"],
        components,
      })[0]?.links,
    ).toEqual([{ inventoryItemId: "shared-item", requiredQuantity: 5 }]);
  });

  it("rejects malformed resolved metadata by returning no mappings", () => {
    expect(
      parseResolvedVariantMappings(
        component({
          metadata: {
            resolved_variant_mappings: [
              {
                bundle_variant_ids: ["bundle"],
                component_variants: [{ variant_id: "missing-inventory" }],
              },
            ],
          },
        }),
      ),
    ).toEqual([]);
  });
});
