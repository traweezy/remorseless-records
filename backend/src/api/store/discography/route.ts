import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { z } from "zod"

import type DiscographyModuleService from "@/modules/discography/service"
import { serializeDiscographyEntry } from "@/modules/discography/serializers"

type DiscographyService = InstanceType<typeof DiscographyModuleService>

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const { limit, offset } = listQuerySchema.parse(req.query)
  const discographyService = req.scope.resolve("discography") as DiscographyService

  const take = limit ?? 200
  const skip = offset ?? 0

  const [entries, count] = await discographyService.listAndCountDiscographyEntries(
    {},
    {
      skip,
      take,
      order: {
        release_year: "DESC",
        release_date: "DESC",
        created_at: "DESC",
      },
    }
  )

  res.status(200).json({
    entries: entries.map(serializeDiscographyEntry),
    count,
    offset: skip,
    limit: take,
  })
}
