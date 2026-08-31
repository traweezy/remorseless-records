import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { MedusaError } from "@medusajs/framework/utils"

import { readStoreDiscographyProductProjections } from "@/lib/store-product-projections"
import {
  listVisibleProductsByIds,
  resolveStoreProductVisibility,
} from "@/lib/store-product-visibility"
import type DiscographyModuleService from "@/modules/discography/service"
import { withStableDiscographyOrder } from "@/modules/discography/list-order"
import {
  type DiscographyEntryRecord,
  serializeDiscographyEntry,
} from "@/modules/discography/serializers"

type DiscographyService = InstanceType<typeof DiscographyModuleService>

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

export const GET = async (
  req: MedusaStoreRequest,
  res: MedusaResponse
): Promise<void> => {
  const parsed = listQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid discography list query"
    )
  }
  const { limit, offset } = parsed.data
  const discographyService = req.scope.resolve(
    "discography"
  ) as DiscographyService
  const { query, salesChannelIds } = resolveStoreProductVisibility(req)

  const take = limit ?? 200
  const skip = offset ?? 0

  const [entries, count] =
    await discographyService.listAndCountDiscographyEntries(
      { archived_at: null },
      {
        skip,
        take,
        order: withStableDiscographyOrder({
          release_year: "DESC",
          release_date: "DESC",
          created_at: "DESC",
        }),
      }
    )
  const records = entries as DiscographyEntryRecord[]
  const productIds = Array.from(
    new Set(
      records.flatMap((entry) =>
        entry.source_mode === "catalog_product" && entry.product_id
          ? [entry.product_id]
          : []
      )
    )
  )
  const rawVisibleProducts = await listVisibleProductsByIds({
    fields: ["id", "handle", "status"],
    productIds,
    query,
    salesChannelIds,
  })
  const visibleProducts =
    readStoreDiscographyProductProjections(rawVisibleProducts)
  const productsById = new Map(
    visibleProducts.map((product) => [product.id, product])
  )

  res.setHeader(
    "Cache-Control",
    "public, max-age=60, s-maxage=300, stale-while-revalidate=600"
  )
  res.setHeader("Vary", "x-publishable-api-key")
  res.status(200).json({
    entries: records.map((entry) => {
      const serialized = serializeDiscographyEntry(
        entry,
        entry.source_mode === "catalog_product"
          ? {
              product: entry.product_id
                ? (productsById.get(entry.product_id) ?? null)
                : null,
            }
          : {}
      )
      return serialized.linkHealth === "healthy"
        ? serialized
        : { ...serialized, productId: null, productHandle: null }
    }),
    count,
    offset: skip,
    limit: take,
  })
}
