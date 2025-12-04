import { MedusaError, Modules } from "@medusajs/framework/utils"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
const COLLECTION_FIELDS = ["id", "title", "handle", "metadata", "created_at", "updated_at"]

export const GET = async (_req: MedusaRequest, res: MedusaResponse): Promise<void> => {
  const productModule = _req.scope.resolve(Modules.PRODUCT) as unknown as {
    listAndCountCollections: (
      filters?: Record<string, unknown>,
      config?: {
        select?: string[]
        skip?: number
        take?: number
        order?: Record<string, "ASC" | "DESC">
      }
    ) => Promise<[unknown[], number]>
  }

  try {
    const handle = typeof _req.query?.handle === "string" ? _req.query.handle.trim() : undefined
    const filters: Record<string, unknown> = {}
    if (handle) {
      filters.handle = handle
    }

    const [collections] = await productModule.listAndCountCollections(
      filters,
      {
        select: COLLECTION_FIELDS,
        order: { created_at: "ASC" },
      }
    )

    res.status(200).json({ collections })
  } catch (error) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Unable to list collections",
      error instanceof Error ? error.message : String(error ?? "unknown error")
    )
  }
}
