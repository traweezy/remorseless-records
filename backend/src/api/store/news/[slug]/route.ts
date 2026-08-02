import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { z } from "@medusajs/framework/zod"
import { MedusaError } from "@medusajs/framework/utils"

import type NewsModuleService from "@/modules/news/service"
import {
  type NewsEntryRecord,
  serializeStoreNewsEntry,
} from "@/modules/news/serializers"
import { buildStoreNewsFilters } from "@/modules/news/store-visibility"

type NewsService = InstanceType<typeof NewsModuleService>

const slugParamSchema = z.object({
  slug: z.string().trim().min(1),
})

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const parsed = slugParamSchema.safeParse(req.params)
  if (!parsed.success) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Invalid news slug.")
  }
  const { slug } = parsed.data
  const newsService = req.scope.resolve("news") as NewsService

  const entries = await newsService.listNewsEntries({
    ...buildStoreNewsFilters(new Date()),
    slug,
  })

  const entry = entries.at(0) as NewsEntryRecord | undefined
  if (!entry) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "News entry not found")
  }

  res.status(200).json({ entry: serializeStoreNewsEntry(entry) })
}
