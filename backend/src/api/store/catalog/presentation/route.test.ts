import {
  ContainerRegistrationKeys,
  ProductStatus,
} from "@medusajs/framework/utils"
import { GET } from "./route"
import { loadStoreCatalogPresentations } from "@/lib/catalog/store-presentation"

jest.mock("@/lib/catalog/store-presentation", () => ({
  ...jest.requireActual("@/lib/catalog/store-presentation"),
  loadStoreCatalogPresentations: jest.fn(),
}))

const setup = () => {
  const graph = jest.fn()
  const catalog = {}
  const resolve = jest.fn((key: string) => {
    if (key === ContainerRegistrationKeys.QUERY) return { graph }
    if (key === "catalog") return catalog
    throw Error("Unexpected service")
  })
  const req = {
    query: { product_ids: "prod_visible,prod_hidden" },
    scope: { resolve },
    publishable_key_context: { key: "pk_test", sales_channel_ids: ["sc_web"] },
  }
  const json = jest.fn(),
    status = jest.fn(),
    setHeader = jest.fn()
  const res = { json, status, setHeader }
  status.mockReturnValue(res)
  return { req, res, graph, resolve, catalog }
}

describe("GET /store/catalog/presentation", () => {
  beforeEach(() => jest.clearAllMocks())
  it("reads editorial data only for published products in the key channel", async () => {
    const { req, res, graph, catalog } = setup()
    graph
      .mockResolvedValueOnce({ data: [{ product_id: "prod_visible" }] })
      .mockResolvedValueOnce({ data: [{ id: "prod_visible" }] })
    jest.mocked(loadStoreCatalogPresentations).mockResolvedValue([])
    await GET(req as never, res as never)
    expect(graph).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        entity: "product_sales_channel",
        filters: {
          product_id: ["prod_visible", "prod_hidden"],
          sales_channel_id: ["sc_web"],
        },
      })
    )
    expect(graph).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        entity: "product",
        filters: { id: ["prod_visible"], status: ProductStatus.PUBLISHED },
      })
    )
    expect(loadStoreCatalogPresentations).toHaveBeenCalledWith(catalog, [
      "prod_visible",
    ])
    expect(res.json).toHaveBeenCalledWith({ presentations: [] })
    expect(res.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "private, no-store"
    )
  })
  it("does not resolve catalog for an invisible product set", async () => {
    const { req, res, graph, resolve } = setup()
    graph.mockResolvedValue({ data: [] })
    await GET(req as never, res as never)
    expect(loadStoreCatalogPresentations).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalledWith("catalog")
    expect(res.json).toHaveBeenCalledWith({ presentations: [] })
  })
  it.each([
    "prod_1,prod_1",
    "",
    "prod_1,other",
    Array.from({ length: 26 }, (_, i) => `prod_${i}`).join(","),
  ])(
    "rejects an invalid or unbounded set before reads",
    async (product_ids) => {
      const { req, res, graph } = setup()
      req.query.product_ids = product_ids
      await expect(GET(req as never, res as never)).rejects.toThrow()
      expect(graph).not.toHaveBeenCalled()
    }
  )
  it("requires a verified publishable-key context", async () => {
    const { req, res, graph } = setup()
    await expect(
      GET({ ...req, publishable_key_context: undefined } as never, res as never)
    ).rejects.toThrow()
    expect(graph).not.toHaveBeenCalled()
  })
})
