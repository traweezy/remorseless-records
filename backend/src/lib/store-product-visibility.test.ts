import {
  ContainerRegistrationKeys,
  ProductStatus,
} from "@medusajs/framework/utils"

import {
  decodeStoreProductCursor,
  encodeStoreProductCursor,
  listVisibleProductPage,
  listVisibleProductsByIds,
  readStoreProductCandidateIds,
  resolveStoreProductVisibility,
  type StoreProductQueryGraph,
} from "./store-product-visibility"

const graph = jest.fn()
const query = { graph } as StoreProductQueryGraph
const decodeProduct = (
  product: Record<string, unknown>
): Record<string, unknown> & { id: string } => {
  if (typeof product.id !== "string") {
    throw new Error("invalid product")
  }
  return { ...product, id: product.id }
}

describe("store product visibility", () => {
  beforeEach(() => {
    graph.mockReset()
  })

  it("requires a publishable-key sales channel", () => {
    expect(() =>
      resolveStoreProductVisibility({
        publishable_key_context: { key: "pk_test", sales_channel_ids: [] },
        scope: { resolve: jest.fn() },
      } as never)
    ).toThrow("A publishable key with a sales channel is required")
  })

  it("resolves the query graph and de-duplicates sales channels", () => {
    const resolve = jest.fn().mockReturnValue(query)

    expect(
      resolveStoreProductVisibility({
        publishable_key_context: {
          key: "pk_test",
          sales_channel_ids: ["sc_1", "sc_1", "sc_2"],
        },
        scope: { resolve },
      } as never)
    ).toEqual({ query, salesChannelIds: ["sc_1", "sc_2"] })
    expect(resolve).toHaveBeenCalledWith(ContainerRegistrationKeys.QUERY)
  })

  it("validates an exact bounded product candidate envelope", () => {
    expect(readStoreProductCandidateIds({ data: [{ id: "prod_1" }] })).toEqual([
      "prod_1",
    ])
    expect(readStoreProductCandidateIds({ data: [] })).toEqual([])
  })

  it.each([
    undefined,
    { data: null },
    { data: [false] },
    { data: [{}] },
    { data: [{ id: " prod_1" }] },
    { data: [{ id: "prod_1" }, { id: "prod_2" }] },
  ])("rejects malformed or ambiguous product candidates", (value) => {
    expect(() => readStoreProductCandidateIds(value)).toThrow(
      "The Store product query returned invalid structured data."
    )
  })

  it("returns only linked published products in candidate order", async () => {
    graph
      .mockResolvedValueOnce({
        data: [{ product_id: "prod_3" }, { product_id: "prod_1" }],
      })
      .mockResolvedValueOnce({
        data: [
          { id: "prod_1", handle: "first" },
          { id: "prod_3", handle: "third" },
        ],
      })

    await expect(
      listVisibleProductsByIds({
        decodeProduct,
        fields: ["id", "handle"],
        productIds: ["prod_1", "prod_2", "prod_3"],
        query,
        salesChannelIds: ["sc_1"],
      })
    ).resolves.toEqual([
      { id: "prod_1", handle: "first" },
      { id: "prod_3", handle: "third" },
    ])
    expect(graph).toHaveBeenNthCalledWith(1, {
      entity: "product_sales_channel",
      fields: ["product_id"],
      filters: {
        product_id: ["prod_1", "prod_2", "prod_3"],
        sales_channel_id: ["sc_1"],
      },
      pagination: { take: 3 },
    })
    expect(graph).toHaveBeenNthCalledWith(2, {
      entity: "product",
      fields: ["id", "handle"],
      filters: {
        id: ["prod_1", "prod_3"],
        status: ProductStatus.PUBLISHED,
      },
      pagination: { take: 2 },
    })
  })

  it.each([
    undefined,
    { data: [null] },
    { data: [{ product_id: "prod_unexpected" }] },
    { data: [{ product_id: " prod_1" }] },
  ])("rejects malformed visibility links", async (value) => {
    graph.mockResolvedValueOnce(value)

    await expect(
      listVisibleProductsByIds({
        decodeProduct,
        fields: ["id"],
        productIds: ["prod_1"],
        query,
        salesChannelIds: ["sc_1"],
      })
    ).rejects.toThrow(
      "The Store product query returned invalid structured data."
    )
    expect(graph).toHaveBeenCalledTimes(1)
  })

  it.each([
    undefined,
    { data: [null] },
    { data: [{ id: "prod_unexpected" }] },
    { data: [{ id: "prod_1" }, { id: "prod_1" }] },
    { data: [{ id: " prod_1" }] },
  ])("rejects malformed published Product rows", async (value) => {
    graph
      .mockResolvedValueOnce({ data: [{ product_id: "prod_1" }] })
      .mockResolvedValueOnce(value)

    await expect(
      listVisibleProductsByIds({
        decodeProduct,
        fields: ["id"],
        productIds: ["prod_1"],
        query,
        salesChannelIds: ["sc_1"],
      })
    ).rejects.toThrow(
      "The Store product query returned invalid structured data."
    )
  })

  it("uses an opaque keyset cursor and a bounded published page", async () => {
    const cursor = encodeStoreProductCursor("prodsc_01ABC")
    const decodedCursor = decodeStoreProductCursor(cursor)
    if (!decodedCursor) {
      throw new Error("Expected a decoded cursor")
    }
    graph
      .mockResolvedValueOnce({
        data: [
          { id: "prodsc_01ABD", product_id: "prod_1" },
          { id: "prodsc_01ABE", product_id: "prod_2" },
          { id: "prodsc_01ABF", product_id: "prod_3" },
        ],
      })
      .mockResolvedValueOnce({
        data: [
          { id: "prod_2", handle: "second" },
          { id: "prod_1", handle: "first" },
        ],
      })

    await expect(
      listVisibleProductPage({
        cursor: decodedCursor,
        decodeProduct,
        fields: ["id", "handle"],
        limit: 2,
        query,
        salesChannelIds: ["sc_1"],
      })
    ).resolves.toEqual({
      nextCursor: "prodsc_01ABE",
      products: [
        { id: "prod_1", handle: "first" },
        { id: "prod_2", handle: "second" },
      ],
    })
    expect(graph).toHaveBeenNthCalledWith(1, {
      entity: "product_sales_channel",
      fields: ["id", "product_id"],
      filters: {
        id: { $gt: "prodsc_01ABC" },
        sales_channel_id: ["sc_1"],
      },
      pagination: { order: { id: "ASC" }, take: 3 },
    })
    expect(graph).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        filters: expect.objectContaining({ status: ProductStatus.PUBLISHED }),
      })
    )
  })

  it.each([
    undefined,
    { data: [null] },
    { data: [{ id: "prodsc_01AAA" }] },
    {
      data: [
        { id: "prodsc_01AAB", product_id: "prod_1" },
        { id: "prodsc_01AAA", product_id: "prod_2" },
      ],
    },
    {
      data: [
        { id: "prodsc_01AAA", product_id: "prod_1" },
        { id: "prodsc_01AAA", product_id: "prod_2" },
      ],
    },
    {
      data: [
        { id: "prodsc_01AAA", product_id: "prod_1" },
        { id: "prodsc_01AAB", product_id: "prod_2" },
        { id: "prodsc_01AAC", product_id: "prod_3" },
      ],
    },
  ])("rejects malformed or over-bound page links", async (value) => {
    graph.mockResolvedValueOnce(value)

    await expect(
      listVisibleProductPage({
        decodeProduct,
        fields: ["id"],
        limit: 1,
        query,
        salesChannelIds: ["sc_1"],
      })
    ).rejects.toThrow(
      "The Store product query returned invalid structured data."
    )
    expect(graph).toHaveBeenCalledTimes(1)
  })

  it("rejects malformed and non-canonical cursors", () => {
    expect(() => decodeStoreProductCursor("../../etc/passwd")).toThrow(
      "Invalid product page cursor"
    )
    expect(() => decodeStoreProductCursor("cHJvZHNjXzAxQUJD=")).toThrow(
      "Invalid product page cursor"
    )
  })
})
