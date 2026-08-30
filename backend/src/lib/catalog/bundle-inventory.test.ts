import {
  buildBundleVariantInventoryPlan,
  parseResolvedVariantMappings,
  reconcileComponentDerivedBundleInventory,
  type CatalogBundleComponentRecord,
} from "./bundle-inventory"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { CatalogBundleStateSnapshot } from "@/modules/catalog/bundle-authoring"

const component = (
  overrides: Partial<CatalogBundleComponentRecord> = {}
): CatalogBundleComponentRecord => ({
  quantity: 1,
  is_required: true,
  metadata: {},
  ...overrides,
})

const resolvedMapping = (input: {
  bundleVariantIds: string[]
  selectionMode?: "exact" | "any"
  variants: Array<{ variantId: string; inventoryItemId: string }>
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
})

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
    ]

    expect(
      buildBundleVariantInventoryPlan({
        bundleVariantIds: ["bundle-cd", "bundle-lp"],
        components,
      })
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
    ])
  })

  it("keeps the first alternative deterministic across cart inventory states", () => {
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
    ]

    expect(
      buildBundleVariantInventoryPlan({
        bundleVariantIds: ["bundle"],
        components,
      })
    ).toEqual([
      {
        bundleVariantId: "bundle",
        links: [{ inventoryItemId: "white-item", requiredQuantity: 2 }],
        selectedAlternativeVariantIds: ["white"],
      },
    ])
  })

  it("keeps the preferred alternative linked without an inventory snapshot", () => {
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
    ]

    expect(
      buildBundleVariantInventoryPlan({
        bundleVariantIds: ["bundle"],
        components,
      })[0]
    ).toEqual({
      bundleVariantId: "bundle",
      links: [{ inventoryItemId: "white-item", requiredQuantity: 1 }],
      selectedAlternativeVariantIds: ["white"],
    })
  })

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
    ]

    expect(
      buildBundleVariantInventoryPlan({
        bundleVariantIds: ["bundle"],
        components,
      })[0]?.links
    ).toEqual([{ inventoryItemId: "shared-item", requiredQuantity: 5 }])
  })

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
        })
      )
    ).toEqual([])
  })
})

type LinkState = {
  inventoryItemId: string
  requiredQuantity: number
  variantId: string
}

const reconciliationHarness = (input: {
  active?: boolean
  actual?: LinkState[]
  inventoryMode?: "component_derived" | "manual"
  provenance?: LinkState[]
}) => {
  let actual = [...(input.actual ?? [])]
  let provenance = [...(input.provenance ?? [])]
  const profile = {
    id: "profile",
    product_id: "bundle-product",
    inventory_mode: input.inventoryMode ?? "component_derived",
    is_active: input.active ?? true,
  }
  const components = [
    component({
      id: "component",
      component_variant_id: "component-variant",
      component_inventory_item_id: "component-item",
    }),
  ]
  const remoteLink = {
    create: jest.fn(async (definitions: Array<Record<string, unknown>>) => {
      definitions.forEach((definition) => {
        const product = definition[Modules.PRODUCT] as { variant_id: string }
        const inventory = definition[Modules.INVENTORY] as {
          inventory_item_id: string
        }
        const data = definition.data as { required_quantity: number }
        actual = actual.filter(
          (link) =>
            !(
              link.variantId === product.variant_id &&
              link.inventoryItemId === inventory.inventory_item_id
            )
        )
        actual.push({
          variantId: product.variant_id,
          inventoryItemId: inventory.inventory_item_id,
          requiredQuantity: data.required_quantity,
        })
      })
      return []
    }),
    dismiss: jest.fn(async (definitions: Array<Record<string, unknown>>) => {
      definitions.forEach((definition) => {
        const product = definition[Modules.PRODUCT] as { variant_id: string }
        const inventory = definition[Modules.INVENTORY] as {
          inventory_item_id: string
        }
        actual = actual.filter(
          (link) =>
            !(
              link.variantId === product.variant_id &&
              link.inventoryItemId === inventory.inventory_item_id
            )
        )
      })
      return []
    }),
  }
  const catalogService = {
    listCatalogBundleProfiles: jest.fn(async () => [profile]),
    listCatalogBundleComponents: jest.fn(async () => components),
    listCatalogBundleInventoryLinks: jest.fn(async () =>
      provenance.map((link, index) => ({
        id: `managed-${index}`,
        bundle_profile_id: "profile",
        bundle_variant_id: link.variantId,
        inventory_item_id: link.inventoryItemId,
        required_quantity: link.requiredQuantity,
        metadata: {},
      }))
    ),
    replaceBundleInventoryLinks: jest.fn(
      async (
        _profileId: string,
        links: Array<{
          bundle_variant_id: string
          inventory_item_id: string
          required_quantity: number
        }>
      ) => {
        provenance = links.map((link) => ({
          variantId: link.bundle_variant_id,
          inventoryItemId: link.inventory_item_id,
          requiredQuantity: link.required_quantity,
        }))
      }
    ),
  }
  const query = {
    graph: jest.fn(async ({ entity }: { entity: string }) =>
      entity === "product"
        ? { data: [{ id: "bundle-product", variants: [{ id: "bundle" }] }] }
        : {
            data: actual.map((link) => ({
              variant_id: link.variantId,
              inventory_item_id: link.inventoryItemId,
              required_quantity: link.requiredQuantity,
            })),
          }
    ),
  }
  const container = {
    resolve: (key: string) => {
      if (key === "catalog") {
        return catalogService
      }
      if (key === ContainerRegistrationKeys.QUERY) {
        return query
      }
      if (key === ContainerRegistrationKeys.REMOTE_LINK) {
        return remoteLink
      }
      if (key === ContainerRegistrationKeys.LOGGER) {
        return { info: jest.fn() }
      }
      throw new Error(`Unexpected dependency: ${key}`)
    },
  }
  return {
    actual: () => actual,
    catalogService,
    container,
    profile,
    provenance: () => provenance,
    remoteLink,
  }
}

const activePreviousSnapshot = (): CatalogBundleStateSnapshot => ({
  profile: {
    id: "profile",
    product_id: "bundle-product",
    product_profile_id: null,
    bundle_type: "fixed",
    inventory_mode: "component_derived",
    fulfillment_mode: "ship_components",
    display_title: null,
    description_html: null,
    is_active: true,
    version: 1,
    metadata: {},
  },
  components: [
    {
      id: "component",
      bundle_profile_id: "profile",
      component_product_id: "component-product",
      component_variant_id: "component-variant",
      component_inventory_item_id: "component-item",
      title: null,
      variant_title: null,
      sku: null,
      quantity: 1,
      sort_order: 0,
      is_required: true,
      metadata: {},
    },
  ],
})

describe("bundle inventory reconciliation", () => {
  it("adopts matching legacy links into managed provenance", async () => {
    const harness = reconciliationHarness({
      actual: [
        {
          variantId: "bundle",
          inventoryItemId: "component-item",
          requiredQuantity: 1,
        },
      ],
    })

    await reconcileComponentDerivedBundleInventory(
      harness.container as never,
      "bundle-product",
      activePreviousSnapshot()
    )

    expect(harness.remoteLink.create).not.toHaveBeenCalled()
    expect(harness.remoteLink.dismiss).not.toHaveBeenCalled()
    expect(harness.provenance()).toEqual([
      {
        variantId: "bundle",
        inventoryItemId: "component-item",
        requiredQuantity: 1,
      },
    ])
  })

  it("dismisses adopted legacy links when component inventory is disabled", async () => {
    const harness = reconciliationHarness({
      active: false,
      actual: [
        {
          variantId: "bundle",
          inventoryItemId: "component-item",
          requiredQuantity: 1,
        },
      ],
    })

    await reconcileComponentDerivedBundleInventory(
      harness.container as never,
      "bundle-product",
      activePreviousSnapshot()
    )

    expect(harness.actual()).toEqual([])
    expect(harness.provenance()).toEqual([])
  })

  it("refuses to replace an inventory link not owned by the bundle", async () => {
    const harness = reconciliationHarness({
      actual: [
        {
          variantId: "bundle",
          inventoryItemId: "component-item",
          requiredQuantity: 7,
        },
      ],
    })

    await expect(
      reconcileComponentDerivedBundleInventory(
        harness.container as never,
        "bundle-product",
        { profile: null, components: [] }
      )
    ).rejects.toThrow("not owned by the bundle workflow")
    expect(harness.remoteLink.create).not.toHaveBeenCalled()
    expect(harness.remoteLink.dismiss).not.toHaveBeenCalled()
  })
})
