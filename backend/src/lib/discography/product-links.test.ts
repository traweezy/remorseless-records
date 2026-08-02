import { loadDiscographyProductLinks } from "./product-links"
import type { DiscographyEntryRecord } from "@/modules/discography/serializers"

const entry = (
  productId: string | null,
  sourceMode: "catalog_product" | "manual"
): DiscographyEntryRecord =>
  ({
    id: `disc_${productId ?? "manual"}`,
    product_id: productId,
    source_mode: sourceMode,
  }) as DiscographyEntryRecord

describe("discography product-link hydration", () => {
  it("loads unique linked products in one batch and ignores manual entries", async () => {
    const listProducts = jest.fn(async () => [
      { handle: "release-one", id: "prod_1", status: "published" },
    ])

    const products = await loadDiscographyProductLinks({ listProducts }, [
      entry("prod_1", "catalog_product"),
      entry("prod_1", "catalog_product"),
      entry(null, "manual"),
    ])

    expect(listProducts).toHaveBeenCalledWith({ id: ["prod_1"] }, { take: 1 })
    expect(products.get("prod_1")).toMatchObject({
      handle: "release-one",
      status: "published",
    })
  })
})
