import { MedusaError, Modules } from "@medusajs/framework/utils"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
const PRODUCT_RELATIONS: string[] = []
const PRODUCT_FIELDS = ["id", "handle", "title", "collection_id", "metadata", "updated_at", "created_at"]

export const GET = async (_req: MedusaRequest, res: MedusaResponse): Promise<void> => {
  const productModule = _req.scope.resolve(Modules.PRODUCT) as {
    listAndCountProducts: (
      filters?: Record<string, unknown>,
      config?: {
        relations?: string[]
        select?: string[]
        skip?: number
        take?: number
        order?: Record<string, "ASC" | "DESC">
      }
    ) => Promise<
      [
        Array<{
          handle?: string | null
          id?: string | null
          updated_at?: string | null
          created_at?: string | null
        }>,
        number
      ]
    >
  }

  try {
    const handles: Array<{
      handle: string
      id: string
      updated_at: string | null
      created_at: string | null
    }> = []

    const pageSize = 200
    let offset = 0
    // paginate through all products
    for (;;) {
      const [products] = await productModule.listAndCountProducts(
        {},
        {
          relations: PRODUCT_RELATIONS,
          select: PRODUCT_FIELDS,
          skip: offset,
          take: pageSize,
          order: { created_at: "ASC" },
        }
      )

      if (!products.length) {
        break
      }

      products.forEach((product) => {
        if (!product.handle || !product.id) {
          return
        }
        handles.push({
          handle: product.handle,
          id: product.id,
          updated_at: (product as { updated_at?: string | null }).updated_at ?? null,
          created_at: (product as { created_at?: string | null }).created_at ?? null,
        })
      })

      if (products.length < pageSize) {
        break
      }

      offset += products.length
    }

    res.status(200).json({ handles })
  } catch (error) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Unable to list product handles",
      error instanceof Error ? error.message : String(error ?? "unknown error")
    )
  }
}
