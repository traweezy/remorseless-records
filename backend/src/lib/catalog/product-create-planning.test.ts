import type { MedusaContainer, ProductTypes } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils"

import { catalogProductCreateSchema } from "./product-create-contract"
import type { CatalogProductCreateCommandInput } from "./product-create-authoring"
import {
  buildCatalogBundleMutation,
  buildCatalogNativeProduct,
  buildCatalogProductProfileMutation,
  resolveCatalogCreatedProduct,
  resolveCatalogProductCreateContext,
  resolveCatalogProductInventoryLevels,
  type CatalogProductCreateContext,
} from "./product-create-planning"

const commandFixture = (
  kind: CatalogProductCreateCommandInput["kind"] = "music_release",
): CatalogProductCreateCommandInput => {
  const bundle =
    kind === "fixed_bundle"
      ? {
          components: [
            {
              componentProductId: "component_product",
              componentVariantId: "component_variant",
              quantity: 2,
            },
          ],
        }
      : kind === "mystery_bundle"
        ? { components: [] }
        : undefined
  const productType = kind === "merch" ? { label: "T-shirt" } : undefined
  return {
    ...catalogProductCreateSchema.parse({
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
      kind,
      title: "A New Product",
      description: "Description",
      options: [{ title: "Format", values: ["Default"] }],
      variants: [
        {
          key: "default",
          title: "Default",
          sku: "PRODUCT-DEFAULT",
          options: { Format: "Default" },
          prices: [{ amount: 12, currencyCode: "usd" }],
          ...(kind === "fixed_bundle" ? {} : { stockQuantity: 0 }),
          profile: { displayLabel: "Default" },
        },
      ],
      profile: {
        ...(kind === "music_release"
          ? { artists: [{ name: "The Artist", role: "primary" }] }
          : {}),
        ...(productType ? { productType } : {}),
      },
      ...(bundle ? { bundle } : {}),
    }),
    actorId: "user_1",
    requestSha256: "request_hash",
  }
}

const contextFixture = (): CatalogProductCreateContext => ({
  bundleComponents: [],
  salesChannelId: "sales_channel_1",
  shippingProfileId: "shipping_profile_1",
  stockLocationId: "stock_location_1",
})

const containerFixture = (queryGraph: jest.Mock): MedusaContainer =>
  ({
    resolve: jest.fn((key: string) => {
      if (key === Modules.FULFILLMENT) {
        return {
          listShippingProfiles: jest
            .fn()
            .mockResolvedValue([{ id: "shipping_profile_1" }]),
        }
      }
      if (key === Modules.STORE) {
        return {
          listStores: jest.fn().mockResolvedValue([
            {
              id: "store_1",
              default_sales_channel_id: "sales_channel_1",
            },
          ]),
        }
      }
      if (key === ContainerRegistrationKeys.QUERY) {
        return { graph: queryGraph }
      }
      throw new Error(`Unexpected dependency ${key}`)
    }),
  }) as unknown as MedusaContainer

describe("catalog product creation planning", () => {
  it("resolves commerce defaults and validates fixed bundle component ownership", async () => {
    const queryGraph = jest.fn(async ({ entity }) => {
      if (entity === "stock_location") {
        return { data: [{ id: "stock_location_1", name: "HQ" }] }
      }
      if (entity === "product_variant") {
        return {
          data: [
            {
              id: "component_variant",
              product_id: "component_product",
            },
          ],
        }
      }
      if (entity === "product_variant_inventory_items") {
        return {
          data: [
            {
              inventory_item_id: "component_inventory",
              variant_id: "component_variant",
            },
          ],
        }
      }
      return { data: [] }
    })

    await expect(
      resolveCatalogProductCreateContext(
        containerFixture(queryGraph),
        commandFixture("fixed_bundle"),
      ),
    ).resolves.toEqual({
      bundleComponents: [
        expect.objectContaining({
          component_inventory_item_id: "component_inventory",
          component_product_id: "component_product",
          component_variant_id: "component_variant",
          quantity: 2,
        }),
      ],
      salesChannelId: "sales_channel_1",
      shippingProfileId: "shipping_profile_1",
      stockLocationId: "stock_location_1",
    })
  })

  it("rejects mismatched and ambiguous fixed bundle inventory before creation", async () => {
    const queryGraph = jest.fn(async ({ entity }) => {
      if (entity === "stock_location") {
        return { data: [{ id: "stock_location_1" }] }
      }
      if (entity === "product_variant") {
        return {
          data: [
            { id: "component_variant", product_id: "different_product" },
          ],
        }
      }
      if (entity === "product_variant_inventory_items") {
        return {
          data: [
            {
              inventory_item_id: "inventory_1",
              variant_id: "component_variant",
            },
            {
              inventory_item_id: "inventory_2",
              variant_id: "component_variant",
            },
          ],
        }
      }
      return { data: [] }
    })
    const container = containerFixture(queryGraph)

    await expect(
      resolveCatalogProductCreateContext(
        container,
        commandFixture("fixed_bundle"),
      ),
    ).rejects.toThrow("does not belong")

    queryGraph.mockImplementation(async ({ entity }) => {
      if (entity === "stock_location") {
        return { data: [{ id: "stock_location_1" }] }
      }
      if (entity === "product_variant") {
        return {
          data: [
            {
              id: "component_variant",
              product_id: "component_product",
            },
          ],
        }
      }
      return {
        data: [
          {
            inventory_item_id: "inventory_1",
            variant_id: "component_variant",
          },
          {
            inventory_item_id: "inventory_2",
            variant_id: "component_variant",
          },
        ],
      }
    })
    await expect(
      resolveCatalogProductCreateContext(
        container,
        commandFixture("fixed_bundle"),
      ),
    ).rejects.toThrow("exactly one inventory item")
  })

  it("builds draft native products with kind-owned inventory", () => {
    const managed = buildCatalogNativeProduct(
      commandFixture("music_release"),
      contextFixture(),
    )
    const fixed = buildCatalogNativeProduct(
      commandFixture("fixed_bundle"),
      contextFixture(),
    )

    expect(managed).toMatchObject({
      handle: "a-new-product",
      sales_channels: [{ id: "sales_channel_1" }],
      shipping_profile_id: "shipping_profile_1",
      status: ProductStatus.DRAFT,
      variants: [
        expect.objectContaining({
          manage_inventory: true,
          metadata: { catalog_creation_variant_key: "default" },
        }),
      ],
    })
    expect(fixed.variants?.[0]).toMatchObject({ manage_inventory: false })
  })

  it("resolves authoritative created variants by their internal stable key", async () => {
    const queryGraph = jest.fn().mockResolvedValue({
      data: [
        {
          id: "product_1",
          variants: [
            {
              id: "variant_1",
              metadata: { catalog_creation_variant_key: "default" },
            },
          ],
        },
      ],
    })
    const products = [{ id: "product_1" }] as ProductTypes.ProductDTO[]

    await expect(
      resolveCatalogCreatedProduct(
        containerFixture(queryGraph),
        commandFixture(),
        products,
      ),
    ).resolves.toMatchObject({
      productId: "product_1",
      targets: [{ variantId: "variant_1" }],
    })

    queryGraph.mockResolvedValue({ data: [{ id: "product_1", variants: [] }] })
    await expect(
      resolveCatalogCreatedProduct(
        containerFixture(queryGraph),
        commandFixture(),
        products,
      ),
    ).rejects.toThrow("could not be resolved")
  })

  it("builds deterministic catalog profile and bundle child commands", () => {
    const profile = buildCatalogProductProfileMutation(
      commandFixture("music_release"),
      "product_1",
    )
    const fixed = buildCatalogBundleMutation(
      commandFixture("fixed_bundle"),
      {
        ...contextFixture(),
        bundleComponents: [
          {
            component_inventory_item_id: "inventory_1",
            component_product_id: "component_product",
            component_variant_id: "component_variant",
            is_required: true,
            metadata: {},
            quantity: 1,
            sku: null,
            sort_order: 0,
            title: null,
            variant_title: null,
          },
        ],
      },
      "product_1",
      "profile_1",
    )
    const mystery = buildCatalogBundleMutation(
      commandFixture("mystery_bundle"),
      contextFixture(),
      "product_2",
      "profile_2",
    )

    expect(profile.patch).toMatchObject({
      descriptionHtml: "Description",
      productType: { label: "Music Release" },
      releaseTitle: "A New Product",
    })
    expect(fixed).toMatchObject({
      command: "catalog.bundle.upsert",
      components: [expect.any(Object)],
      profile: {
        bundle_type: "fixed",
        fulfillment_mode: "ship_components",
        inventory_mode: "component_derived",
      },
    })
    expect(mystery).toMatchObject({
      components: [],
      profile: {
        bundle_type: "mystery",
        fulfillment_mode: "manual",
        inventory_mode: "manual",
      },
    })
  })

  it("creates explicit zero-stock levels and skips owned stock for fixed bundles", async () => {
    const queryGraph = jest.fn().mockResolvedValue({
      data: [
        {
          inventory_item_id: "inventory_1",
          variant_id: "variant_1",
        },
      ],
    })
    const created = {
      productId: "product_1",
      targets: [
        {
          definition: commandFixture().variants[0]!,
          variantId: "variant_1",
        },
      ],
    }

    await expect(
      resolveCatalogProductInventoryLevels(
        containerFixture(queryGraph),
        commandFixture(),
        contextFixture(),
        created,
      ),
    ).resolves.toEqual([
      {
        inventory_item_id: "inventory_1",
        location_id: "stock_location_1",
        stocked_quantity: 0,
      },
    ])
    await expect(
      resolveCatalogProductInventoryLevels(
        containerFixture(queryGraph),
        commandFixture("fixed_bundle"),
        contextFixture(),
        created,
      ),
    ).resolves.toEqual([])
  })
})
