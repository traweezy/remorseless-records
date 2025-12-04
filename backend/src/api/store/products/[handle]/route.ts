import { MedusaError, Modules } from "@medusajs/framework/utils"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"

const PRODUCT_RELATIONS = [
  "collection",
  "tags",
  "images",
  "metadata",
  "variants",
  "variants.prices",
  "variants.options",
  "variants.options.option",
  "options",
  "options.values",
  "categories",
  "categories.parent_category",
  "categories.parent_category.parent_category",
]

const PRODUCT_FIELDS = [
  "id",
  "title",
  "subtitle",
  "description",
  "handle",
  "collection_id",
  "thumbnail",
  "metadata",
]

export const GET = async (req: MedusaRequest, res: MedusaResponse): Promise<void> => {
  const handle = typeof req.params?.handle === "string" ? req.params.handle.trim() : null
  if (!handle) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Product handle is required")
  }

  const productModule = req.scope.resolve(Modules.PRODUCT) as {
    listAndCountProducts: (
      filters?: Record<string, unknown>,
      config?: {
        relations?: string[]
        select?: string[]
        skip?: number
        take?: number
        order?: Record<string, "ASC" | "DESC">
      }
    ) => Promise<[unknown[], number]>
  }

  try {
    const [products] = await productModule.listAndCountProducts(
      { handle },
      { relations: PRODUCT_RELATIONS, select: PRODUCT_FIELDS, take: 1 }
    )

    const product = products.at(0)
    if (!product) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Product ${handle} not found`)
    }

    res.status(200).json({ product })
  } catch (error) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Unable to load product ${handle}`,
      error instanceof Error ? error.message : String(error ?? "unknown error")
    )
  }
}
