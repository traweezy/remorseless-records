import type { MedusaRequest } from "@medusajs/framework"

import {
  assertProductExists,
  assertProductsExist,
  assertVariantBelongsToProduct,
} from "./utils"

const requestFixture = (graph: jest.Mock): MedusaRequest =>
  ({
    scope: { resolve: jest.fn(() => ({ graph })) },
  }) as unknown as MedusaRequest

describe("catalog admin query assertions", () => {
  it("distinguishes an authoritative missing product from malformed rows", async () => {
    const graph = jest.fn().mockResolvedValue({ data: [] })
    const req = requestFixture(graph)

    await expect(assertProductExists(req, "prod_missing")).rejects.toThrow(
      "Product not found"
    )

    graph.mockResolvedValue({ data: [null] })
    await expect(assertProductExists(req, "prod_01")).rejects.toThrow(
      "The catalog persistence boundary returned invalid structured data"
    )
  })

  it("requires every requested product without accepting unexpected rows", async () => {
    const graph = jest.fn().mockResolvedValue({
      data: [{ id: "prod_01" }, { id: "prod_02" }],
    })
    const req = requestFixture(graph)

    await expect(
      assertProductsExist(req, ["prod_01", "prod_02", "prod_01"])
    ).resolves.toBeUndefined()

    graph.mockResolvedValue({ data: [{ id: "prod_01" }] })
    await expect(
      assertProductsExist(req, ["prod_01", "prod_02"])
    ).rejects.toThrow("Product not found: prod_02")

    graph.mockResolvedValue({ data: [{ id: "prod_unrequested" }] })
    await expect(assertProductsExist(req, ["prod_01"])).rejects.toThrow(
      "The catalog persistence boundary returned invalid structured data"
    )
  })

  it("requires one consistent product relationship for variant ownership", async () => {
    const graph = jest.fn().mockResolvedValue({
      data: [
        {
          id: "variant_01",
          product_id: "prod_01",
          product: { id: "prod_01" },
        },
      ],
    })
    const req = requestFixture(graph)

    await expect(
      assertVariantBelongsToProduct(req, "prod_01", "variant_01")
    ).resolves.toBeUndefined()

    graph.mockResolvedValue({
      data: [
        {
          id: "variant_01",
          product_id: "prod_01",
          product: { id: "prod_other" },
        },
      ],
    })
    await expect(
      assertVariantBelongsToProduct(req, "prod_01", "variant_01")
    ).rejects.toThrow(
      "The catalog persistence boundary returned invalid structured data"
    )

    graph.mockResolvedValue({
      data: [{ id: "variant_01", product_id: "prod_other" }],
    })
    await expect(
      assertVariantBelongsToProduct(req, "prod_01", "variant_01")
    ).rejects.toThrow("Product variant must belong to the product")
  })
})
