import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import type NewsModuleService from "@/modules/news/service"
import { serializeNewsEntry } from "@/modules/news/serializers"

type NewsService = InstanceType<typeof NewsModuleService>

const slugParamSchema = z.object({
  slug: z.string().trim().min(1),
})

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const { slug } = slugParamSchema.parse(req.params)
  const newsService = req.scope.resolve("news") as NewsService

  const entries = await newsService.listNewsEntries({
    slug,
    status: "published",
  })

  const entry = entries.at(0)
  if (!entry) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "News entry not found")
  }

  res.status(200).json({ entry: serializeNewsEntry(entry) })
}
