import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"

import type NewsModuleService from "@/modules/news/service"
import {
  type NewsEntryRecord,
  serializeNewsEntry,
} from "@/modules/news/serializers"
import { newsUpdateSchema, updateNewsEntry } from "../helpers"

type NewsService = InstanceType<typeof NewsModuleService>

const requireId = (req: MedusaRequest): string => {
  const id = req.params.id
  if (!id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "News post id is required."
    )
  }
  return id
}

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const newsService = req.scope.resolve("news") as NewsService
  const entry = (await newsService.retrieveNewsEntry(
    requireId(req)
  )) as NewsEntryRecord | null
  if (!entry) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "News post not found.")
  }
  res.status(200).json({ entry: serializeNewsEntry(entry) })
}

export const PUT = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const parsed = newsUpdateSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid news payload."
    )
  }
  const newsService = req.scope.resolve("news") as NewsService
  const result = await updateNewsEntry(
    req,
    newsService,
    requireId(req),
    parsed.data
  )
  res.status(200).json(result)
}

export const DELETE = async (): Promise<void> => {
  throw new MedusaError(
    MedusaError.Types.CONFLICT,
    "News posts are retained for audit history. Archive the post instead."
  )
}
