import { ProductStatus } from "@medusajs/framework/utils"

import { GET } from "./route"

describe("GET /store/products/handles", () => {
  it("returns a bounded keyset page scoped to published channel products", async () => {
    const graph = jest
      .fn()
      .mockResolvedValueOnce({
        data: [
          { id: "prodsc_01AAA", product_id: "prod_1" },
          { id: "prodsc_01AAB", product_id: "prod_2" },
          { id: "prodsc_01AAC", product_id: "prod_3" },
        ],
      })
      .mockResolvedValueOnce({
        data: [
          {
            created_at: "2026-08-01T00:00:00.000Z",
            handle: "first-release",
            id: "prod_1",
            updated_at: "2026-08-28T00:00:00.000Z",
          },
          {
            created_at: "2026-08-02T00:00:00.000Z",
            handle: "second-release",
            id: "prod_2",
            updated_at: null,
          },
        ],
      })
    const setHeader = jest.fn()
    const json = jest.fn()
    const status = jest.fn().mockReturnValue({ json })

    await GET(
      {
        publishable_key_context: {
          key: "pk_test",
          sales_channel_ids: ["sc_web"],
        },
        query: { limit: "2" },
        scope: { resolve: jest.fn().mockReturnValue({ graph }) },
      } as never,
      { json, setHeader, status } as never
    )

    expect(graph).toHaveBeenNthCalledWith(1, {
      entity: "product_sales_channel",
      fields: ["id", "product_id"],
      filters: { sales_channel_id: ["sc_web"] },
      pagination: { order: { id: "ASC" }, skip: 0, take: 3 },
    })
    expect(graph).toHaveBeenNthCalledWith(2, {
      entity: "product",
      fields: ["id", "handle", "updated_at", "created_at"],
      filters: {
        id: ["prod_1", "prod_2"],
        status: ProductStatus.PUBLISHED,
      },
      pagination: { take: 2 },
    })
    expect(setHeader).toHaveBeenCalledWith("Vary", "x-publishable-api-key")
    expect(status).toHaveBeenCalledWith(200)
    expect(json).toHaveBeenCalledWith({
      handles: [
        {
          created_at: "2026-08-01T00:00:00.000Z",
          handle: "first-release",
          id: "prod_1",
          updated_at: "2026-08-28T00:00:00.000Z",
        },
        {
          created_at: "2026-08-02T00:00:00.000Z",
          handle: "second-release",
          id: "prod_2",
          updated_at: null,
        },
      ],
      next_cursor: Buffer.from("prodsc_01AAB", "utf8").toString("base64url"),
    })
  })

  it("rejects an invalid cursor before querying products", async () => {
    const graph = jest.fn()

    await expect(
      GET(
        {
          publishable_key_context: {
            key: "pk_test",
            sales_channel_ids: ["sc_web"],
          },
          query: { cursor: "../../invalid" },
          scope: { resolve: jest.fn().mockReturnValue({ graph }) },
        } as never,
        {} as never
      )
    ).rejects.toThrow("Invalid product page cursor")
    expect(graph).not.toHaveBeenCalled()
  })

  it("rejects malformed Product fields instead of advancing past them", async () => {
    const graph = jest
      .fn()
      .mockResolvedValueOnce({
        data: [{ id: "prodsc_01AAA", product_id: "prod_1" }],
      })
      .mockResolvedValueOnce({
        data: [
          {
            created_at: "not-a-date",
            handle: "first-release",
            id: "prod_1",
            updated_at: null,
          },
        ],
      })

    await expect(
      GET(
        {
          publishable_key_context: {
            key: "pk_test",
            sales_channel_ids: ["sc_web"],
          },
          query: { limit: "1" },
          scope: { resolve: jest.fn().mockReturnValue({ graph }) },
        } as never,
        {} as never
      )
    ).rejects.toThrow(
      "The Store product projection returned invalid structured data."
    )
  })
})
