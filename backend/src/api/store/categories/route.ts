import { MedusaError, Modules } from "@medusajs/framework/utils"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
const CATEGORY_FIELDS = ["id", "name", "handle", "parent_category_id", "metadata", "created_at", "updated_at"]

export const GET = async (_req: MedusaRequest, res: MedusaResponse): Promise<void> => {
  const productModule = _req.scope.resolve(Modules.PRODUCT) as {
    listAndCountProductCategories: (
      filters?: Record<string, unknown>,
      config?: {
        select?: string[]
        relations?: string[]
        skip?: number
        take?: number
        order?: Record<string, "ASC" | "DESC">
      }
    ) => Promise<[unknown[], number]>
  }

  try {
    const [categories] = await productModule.listAndCountProductCategories(
      {},
      {
        select: CATEGORY_FIELDS,
        relations: ["category_children", "parent_category"],
        order: { created_at: "ASC" },
        take: 500,
      }
    )

    res.status(200).json({ categories })
  } catch (error) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Unable to list categories",
      error instanceof Error ? error.message : String(error ?? "unknown error")
    )
  }
}
