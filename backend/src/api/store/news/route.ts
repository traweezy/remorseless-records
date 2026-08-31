import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { z } from "@medusajs/framework/zod"
import { MedusaError } from "@medusajs/framework/utils"

import { withStableNewsOrder } from "@/modules/news/list-order"
import type NewsModuleService from "@/modules/news/service"
import { readStoreNewsPage } from "@/lib/store-module-projections"
import { serializeStoreNewsEntry } from "@/modules/news/serializers"
import { buildStoreNewsFilters } from "@/modules/news/store-visibility"

type NewsService = InstanceType<typeof NewsModuleService>

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
      "Invalid news list query."
    )
  }
  const { limit, offset } = parsed.data
  const newsService = req.scope.resolve<NewsService>("news")

  const take = limit ?? 20
  const skip = offset ?? 0

  const now = new Date()
  const result = await newsService.listAndCountNewsEntries(
    buildStoreNewsFilters(now),
    {
      skip,
      take,
      order: withStableNewsOrder({
        published_at: "DESC",
        created_at: "DESC",
      }),
    }
  )
  const { count, records } = readStoreNewsPage(result, now, {
    limit: take,
    offset: skip,
  })

  res.status(200).json({
    entries: records.map(serializeStoreNewsEntry),
    count,
    offset: skip,
    limit: take,
  })
}
