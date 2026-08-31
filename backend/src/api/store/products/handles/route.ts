import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import {
  readStoreProductHandleProjection,
  readStoreProductHandleProjections,
} from "@/lib/store-product-projections"
import {
  decodeStoreProductCursor,
  encodeStoreProductCursor,
  listVisibleProductPage,
  resolveStoreProductVisibility,
  STORE_PRODUCT_PAGE_LIMIT,
} from "@/lib/store-product-visibility"

const PRODUCT_HANDLE_FIELDS = [
  "id",
  "handle",
  "updated_at",
  "created_at",
] as const

const listQuerySchema = z
  .object({
    cursor: z.string().trim().min(1).max(256).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(STORE_PRODUCT_PAGE_LIMIT)
      .optional(),
  })
  .strict()

export const GET = async (
  req: MedusaStoreRequest,
  res: MedusaResponse
): Promise<void> => {
  const parsed = listQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid product handle page query"
    )
  }

  const { query, salesChannelIds } = resolveStoreProductVisibility(req)
  const cursor = decodeStoreProductCursor(parsed.data.cursor)
  const { nextCursor, products } = await listVisibleProductPage({
    ...(cursor ? { cursor } : {}),
    decodeProduct: readStoreProductHandleProjection,
    fields: PRODUCT_HANDLE_FIELDS,
    limit: parsed.data.limit ?? STORE_PRODUCT_PAGE_LIMIT,
    query,
    salesChannelIds,
  })
  const handles = readStoreProductHandleProjections(products)

  res.setHeader(
    "Cache-Control",
    "public, max-age=60, s-maxage=900, stale-while-revalidate=1800"
  )
  res.setHeader("Vary", "x-publishable-api-key")
  res.status(200).json({
    handles,
    next_cursor: nextCursor ? encodeStoreProductCursor(nextCursor) : null,
  })
}
