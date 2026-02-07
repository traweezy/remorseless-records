import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { z } from "zod"

import type NewsModuleService from "@/modules/news/service"
import { serializeNewsEntry } from "@/modules/news/serializers"

type NewsService = InstanceType<typeof NewsModuleService>

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const { limit, offset } = listQuerySchema.parse(req.query)
  const newsService = req.scope.resolve("news") as NewsService

  const take = limit ?? 20
  const skip = offset ?? 0

  const [entries, count] = await newsService.listAndCountNewsEntries(
    { status: "published" },
    {
      skip,
      take,
      order: {
        published_at: "DESC",
        created_at: "DESC",
      },
    }
  )

  res.status(200).json({
    entries: entries.map(serializeNewsEntry),
    count,
    offset: skip,
    limit: take,
  })
}
