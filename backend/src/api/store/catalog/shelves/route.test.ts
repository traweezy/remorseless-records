import {
  ContainerRegistrationKeys,
  ProductStatus,
} from "@medusajs/framework/utils"

import { GET } from "./route"

const shelf = {
  archived_at: null,
  automation_type: "none",
  created_at: "2026-08-01T00:00:00.000Z",
  description: null,
  ends_at: null,
  handle: "featured",
  id: "cshelf_1",
  is_active: true,
  metadata: {},
  mode: "manual",
  product_limit: 12,
  ribbon_label: "Featured",
  ribbon_priority: 1,
  show_ribbon: true,
  starts_at: null,
  title: "Featured releases",
  updated_at: "2026-08-02T00:00:00.000Z",
  version: 1,
}

const membership = {
  ends_at: null,
  id: "cshelfprod_1",
  is_pinned: false,
  metadata: {},
  product_id: "prod_1",
  product_profile_id: null,
  shelf_id: "cshelf_1",
  sort_order: 0,
  starts_at: null,
}

const request = (catalog: Record<string, unknown>, graph: jest.Mock) => ({
  publishable_key_context: {
    key: "pk_test",
    sales_channel_ids: ["sc_web"],
  },
  query: {},
  scope: {
    resolve: jest.fn((key: string) =>
      key === ContainerRegistrationKeys.QUERY ? { graph } : catalog
    ),
  },
})

describe("GET /store/catalog/shelves", () => {
  it("returns only validated visible Product memberships", async () => {
    const catalog = {
      listAndCountCatalogShelves: jest.fn().mockResolvedValue([[shelf], 1]),
      listCatalogShelfProducts: jest.fn().mockResolvedValue([membership]),
    }
    const graph = jest
      .fn()
      .mockResolvedValueOnce({ data: [{ product_id: "prod_1" }] })
      .mockResolvedValueOnce({
        data: [
          {
            created_at: "2026-08-01T00:00:00.000Z",
            id: "prod_1",
          },
        ],
      })
    const json = jest.fn()
    const setHeader = jest.fn()
    const status = jest.fn().mockReturnValue({ json })

    await GET(
      request(catalog, graph) as never,
      { json, setHeader, status } as never
    )

    expect(graph).toHaveBeenNthCalledWith(2, {
      entity: "product",
      fields: ["id", "created_at"],
      filters: {
        id: ["prod_1"],
        status: ProductStatus.PUBLISHED,
      },
      pagination: { take: 1 },
    })
    expect(setHeader).toHaveBeenCalledWith("Vary", "x-publishable-api-key")
    expect(status).toHaveBeenCalledWith(200)
    expect(json).toHaveBeenCalledWith({
      shelves: [
        {
          productIds: ["prod_1"],
          shelf: expect.objectContaining({
            handle: "featured",
            id: "cshelf_1",
            title: "Featured releases",
          }),
        },
      ],
    })
  })

  it("rejects malformed Product timestamps instead of hiding a membership", async () => {
    const catalog = {
      listAndCountCatalogShelves: jest.fn().mockResolvedValue([[shelf], 1]),
      listCatalogShelfProducts: jest.fn().mockResolvedValue([membership]),
    }
    const graph = jest
      .fn()
      .mockResolvedValueOnce({ data: [{ product_id: "prod_1" }] })
      .mockResolvedValueOnce({
        data: [{ created_at: "not-a-date", id: "prod_1" }],
      })

    await expect(
      GET(request(catalog, graph) as never, {} as never)
    ).rejects.toThrow(
      "The Store product projection returned invalid structured data."
    )
  })
})
