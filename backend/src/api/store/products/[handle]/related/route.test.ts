import { ProductStatus } from "@medusajs/framework/utils"

import { GET } from "./route"

describe("GET /store/products/:handle/related", () => {
  it("uses only bounded published products linked to the key sales channel", async () => {
    const target = {
      categories: [
        {
          handle: "doom",
          id: "pcat_doom",
          name: "Doom",
          parent_category: null,
          parent_category_id: null,
        },
      ],
      collection: { id: "collection_1", title: "Collection" },
      collection_id: "collection_1",
      handle: "target-release",
      id: "prod_target",
      metadata: { artist: "Target Artist" },
      status: ProductStatus.PUBLISHED,
      title: "Target Artist - Target Release",
    }
    const related = {
      categories: [
        {
          handle: "death",
          id: "pcat_death",
          name: "Death",
          parent_category: null,
          parent_category_id: null,
        },
      ],
      collection: { id: "collection_1", title: "Collection" },
      collection_id: "collection_1",
      handle: "related-release",
      id: "prod_related",
      metadata: { artist: "Another Artist" },
      status: ProductStatus.PUBLISHED,
      title: "Another Artist - Related Release",
    }
    const graph = jest
      .fn()
      .mockResolvedValueOnce({ data: [{ id: "prod_target" }] })
      .mockResolvedValueOnce({ data: [{ product_id: "prod_target" }] })
      .mockResolvedValueOnce({ data: [target] })
      .mockResolvedValueOnce({
        data: [
          { id: "prodsc_02", product_id: "prod_related" },
          { id: "prodsc_01", product_id: "prod_target" },
        ],
      })
      .mockResolvedValueOnce({ data: [related, target] })
    const json = jest.fn()
    const setHeader = jest.fn()
    const status = jest.fn().mockReturnValue({ json })

    await GET(
      {
        params: { handle: "target-release" },
        publishable_key_context: {
          key: "pk_test",
          sales_channel_ids: ["sc_web"],
        },
        scope: { resolve: jest.fn().mockReturnValue({ graph }) },
      } as never,
      { json, setHeader, status } as never
    )

    expect(graph).toHaveBeenNthCalledWith(1, {
      entity: "product",
      fields: ["id"],
      filters: {
        handle: "target-release",
        status: ProductStatus.PUBLISHED,
      },
      pagination: { take: 1 },
    })
    expect(graph).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        entity: "product_sales_channel",
        filters: expect.objectContaining({ sales_channel_id: ["sc_web"] }),
      })
    )
    expect(graph).toHaveBeenNthCalledWith(4, {
      entity: "product_sales_channel",
      fields: ["id", "product_id"],
      filters: { sales_channel_id: ["sc_web"] },
      pagination: { order: { id: "DESC" }, take: 101 },
    })
    expect(status).toHaveBeenCalledWith(200)
    expect(setHeader).toHaveBeenCalledWith("Vary", "x-publishable-api-key")
    expect(json).toHaveBeenCalledWith({ products: [related] })
  })

  it("does not expose a published product outside the key sales channel", async () => {
    const graph = jest
      .fn()
      .mockResolvedValueOnce({ data: [{ id: "prod_target" }] })
      .mockResolvedValueOnce({ data: [] })

    await expect(
      GET(
        {
          params: { handle: "target-release" },
          publishable_key_context: {
            key: "pk_test",
            sales_channel_ids: ["sc_web"],
          },
          scope: { resolve: jest.fn().mockReturnValue({ graph }) },
        } as never,
        {} as never
      )
    ).rejects.toThrow("Product target-release not found")
  })

  it("rejects malformed related Product fields instead of returning raw data", async () => {
    const graph = jest
      .fn()
      .mockResolvedValueOnce({ data: [{ id: "prod_target" }] })
      .mockResolvedValueOnce({ data: [{ product_id: "prod_target" }] })
      .mockResolvedValueOnce({
        data: [
          {
            categories: [],
            collection: null,
            collection_id: null,
            handle: "target-release",
            id: "prod_target",
            metadata: { artist: false },
            status: ProductStatus.PUBLISHED,
            title: "Target Release",
          },
        ],
      })

    await expect(
      GET(
        {
          params: { handle: "target-release" },
          publishable_key_context: {
            key: "pk_test",
            sales_channel_ids: ["sc_web"],
          },
          scope: { resolve: jest.fn().mockReturnValue({ graph }) },
        } as never,
        {} as never
      )
    ).rejects.toThrow(
      "The Store product projection returned invalid structured data."
    )
  })
})
