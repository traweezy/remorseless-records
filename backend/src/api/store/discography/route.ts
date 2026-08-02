import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { z } from "@medusajs/framework/zod"
import { MedusaError, Modules } from "@medusajs/framework/utils"

import {
  loadDiscographyProductLinks,
  type DiscographyProductReader,
} from "@/lib/discography/product-links"
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
  req: MedusaRequest,
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
  const productService = req.scope.resolve(
    Modules.PRODUCT
  ) as DiscographyProductReader

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
  const productsById = await loadDiscographyProductLinks(
    productService,
    records
  )

  res.status(200).json({
    entries: records.map((entry) =>
      serializeDiscographyEntry(
        entry,
        entry.source_mode === "catalog_product"
          ? {
              product: entry.product_id
                ? (productsById.get(entry.product_id) ?? null)
                : null,
            }
          : {}
      )
    ),
    count,
    offset: skip,
    limit: take,
  })
}
