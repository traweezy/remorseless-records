import type {
  DiscographyEntryRecord,
  DiscographyLinkedProduct,
} from "@/modules/discography/serializers"
import { readAdminDiscographyProducts } from "@/lib/content/persistence-contracts"

export type DiscographyProductReader = {
  listProducts: (
    filters: Record<string, unknown>,
    config: { take: number }
  ) => Promise<unknown>
}

export type DiscographyLinkedProductWithId = DiscographyLinkedProduct & {
  id: string
}

export const loadDiscographyProductLinks = async (
  productReader: DiscographyProductReader,
  entries: readonly DiscographyEntryRecord[]
): Promise<Map<string, DiscographyLinkedProductWithId>> => {
  const productIds = [
    ...new Set(
      entries.flatMap((entry) =>
        entry.source_mode === "catalog_product" && entry.product_id
          ? [entry.product_id]
          : []
      )
    ),
  ]
  if (!productIds.length) {
    return new Map()
  }

  const products = readAdminDiscographyProducts(
    await productReader.listProducts(
      { id: productIds },
      { take: productIds.length }
    ),
    productIds
  )
  return new Map(products.map((product) => [product.id, product]))
}
