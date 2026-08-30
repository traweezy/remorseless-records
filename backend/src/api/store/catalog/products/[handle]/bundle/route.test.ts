import {
  ContainerRegistrationKeys,
  ProductStatus,
} from "@medusajs/framework/utils"

import { GET } from "./route"

describe("GET /store/catalog/products/:handle/bundle", () => {
  it("redacts component products and variants outside the key channel", async () => {
    const graph = jest
      .fn()
      .mockResolvedValueOnce({ data: [{ id: "prod_bundle" }] })
      .mockResolvedValueOnce({ data: [{ product_id: "prod_bundle" }] })
      .mockResolvedValueOnce({
        data: [
          {
            handle: "public-bundle",
            id: "prod_bundle",
            title: "Public Bundle",
            variants: [{ id: "variant_bundle", title: "Bundle" }],
          },
        ],
      })
      .mockResolvedValueOnce({ data: [] })
    const catalog = {
      listCatalogBundleProfiles: jest.fn().mockResolvedValue([
        {
          bundle_type: "fixed",
          id: "bundle_profile_1",
          is_active: true,
          product_id: "prod_bundle",
        },
      ]),
      listCatalogBundleComponents: jest.fn().mockResolvedValue([
        {
          component_product_id: "prod_hidden",
          id: "bundle_component_1",
          is_required: true,
          metadata: {
            resolved_variant_mappings: [
              {
                bundle_variant_ids: ["variant_bundle"],
                component_variants: [
                  {
                    inventory_item_id: "iitem_hidden",
                    sku: "hidden-sku",
                    variant_id: "variant_hidden",
                  },
                ],
                selection_mode: "exact",
              },
            ],
          },
          quantity: 1,
        },
      ]),
    }
    const resolve = jest.fn((key: string) => {
      if (key === ContainerRegistrationKeys.QUERY) {
        return { graph }
      }
      if (key === "catalog") {
        return catalog
      }
      throw new Error(`Unexpected dependency: ${key}`)
    })
    const json = jest.fn()
    const setHeader = jest.fn()
    const status = jest.fn().mockReturnValue({ json })

    await GET(
      {
        params: { handle: "public-bundle" },
        publishable_key_context: {
          key: "pk_test",
          sales_channel_ids: ["sc_web"],
        },
        scope: { resolve },
      } as never,
      { json, setHeader, status } as never
    )

    expect(graph).toHaveBeenNthCalledWith(1, {
      entity: "product",
      fields: ["id"],
      filters: {
        handle: "public-bundle",
        status: ProductStatus.PUBLISHED,
      },
      pagination: { take: 1 },
    })
    expect(graph).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        entity: "product_sales_channel",
        filters: expect.objectContaining({
          product_id: ["prod_hidden"],
          sales_channel_id: ["sc_web"],
        }),
      })
    )
    expect(graph).toHaveBeenCalledTimes(4)
    expect(setHeader).toHaveBeenCalledWith("Vary", "x-publishable-api-key")
    expect(status).toHaveBeenCalledWith(200)

    const response = json.mock.calls[0]?.[0]
    expect(response).toMatchObject({
      bundle: {
        componentCount: 1,
        components: [
          {
            availabilityByBundleVariant: [
              {
                available: false,
                options: [],
              },
            ],
            product: { handle: null, id: null, title: null },
          },
        ],
        hasUnavailableComponents: true,
        productId: "prod_bundle",
        unavailableMappingCount: 1,
      },
    })
    expect(JSON.stringify(response)).not.toContain("prod_hidden")
    expect(JSON.stringify(response)).not.toContain("variant_hidden")
    expect(JSON.stringify(response)).not.toContain("hidden-sku")
  })
})
