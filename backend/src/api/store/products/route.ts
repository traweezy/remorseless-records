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

const PRODUCT_FIELDS = ["id", "title", "subtitle", "description", "handle", "collection_id", "thumbnail", "metadata"]

const DEFAULT_PAGE_SIZE = 24
const MAX_PAGE_SIZE = 200
const MAX_OFFSET = 100_000

const parsePositiveInt = (value: unknown, fallback: number, max?: number): number => {
  if (typeof value === "string") {
    const parsed = parseInt(value, 10)
    if (!Number.isNaN(parsed) && parsed > 0) {
      return max ? Math.min(parsed, max) : parsed
    }
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const normalized = Math.trunc(value)
    return max ? Math.min(normalized, max) : normalized
  }
  return fallback
}

const parseOrder = (value: unknown): Record<string, "ASC" | "DESC"> => {
  if (typeof value !== "string") {
    return { created_at: "DESC" }
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === "title") {
    return { title: "ASC" }
  }
  if (normalized === "-title" || normalized === "title:desc") {
    return { title: "DESC" }
  }
  if (normalized === "created_at" || normalized === "created-at") {
    return { created_at: "ASC" }
  }
  if (normalized === "-created_at" || normalized === "created-at:desc") {
    return { created_at: "DESC" }
  }

  return { created_at: "DESC" }
}

export const GET = async (req: MedusaRequest, res: MedusaResponse): Promise<void> => {
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

  const search = typeof req.query?.q === "string" ? req.query.q.trim() : undefined
  const category = typeof req.query?.category === "string" ? req.query.category.trim() : undefined
  const collection = typeof req.query?.collection === "string" ? req.query.collection.trim() : undefined
  const limit = parsePositiveInt(req.query?.limit, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
  const offset = parsePositiveInt(req.query?.offset, 0, MAX_OFFSET)
  const order = parseOrder(req.query?.order)

  const filters: Record<string, unknown> = {}
  if (search) {
    filters.q = search
  }
  if (category) {
    filters.category_id = category
  }
  if (collection) {
    filters.collection_id = collection
  }

  try {
    const [products, count] = await productModule.listAndCountProducts(filters, {
      relations: PRODUCT_RELATIONS,
      select: PRODUCT_FIELDS,
      skip: offset,
      take: limit,
      order,
    })

    res.status(200).json({ products, count, limit, offset })
  } catch (error) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Unable to load products",
      error instanceof Error ? error.message : String(error ?? "unknown error")
    )
  }
}
