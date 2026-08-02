import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { z } from "@medusajs/framework/zod"
import { MedusaError } from "@medusajs/framework/utils"

import { withStableNewsOrder } from "@/modules/news/list-order"
import type NewsModuleService from "@/modules/news/service"
import {
  newsStatusValues,
  type NewsEntryRecord,
  serializeNewsEntry,
} from "@/modules/news/serializers"
import { createNewsEntry, newsCreateSchema } from "./helpers"

type NewsService = InstanceType<typeof NewsModuleService>

const listQuerySchema = z.object({
  archived: z.enum(["active", "archived", "all"]).optional(),
  direction: z.enum(["asc", "desc"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  order: z
    .enum(["created_at", "published_at", "status", "title", "updated_at"])
    .optional(),
  q: z.string().trim().max(200).optional(),
  status: z.enum(newsStatusValues).optional(),
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
  const {
    archived = "active",
    direction,
    limit,
    offset,
    order,
    q,
    status,
  } = parsed.data
  const take = limit ?? 25
  const skip = offset ?? 0
  const sortField = order ?? "updated_at"
  const sortDirection = (direction ?? "desc").toUpperCase() as "ASC" | "DESC"
  const filters: Record<string, unknown> = {}
  if (q) filters.q = q
  if (status && status !== "archived") filters.status = status
  const archiveFilter = status === "archived" ? "archived" : archived
  if (archiveFilter === "active") filters.archived_at = null
  if (archiveFilter === "archived") filters.archived_at = { $ne: null }

  const newsService = req.scope.resolve("news") as NewsService
  const [entries, count] = await newsService.listAndCountNewsEntries(filters, {
    skip,
    take,
    order: withStableNewsOrder({ [sortField]: sortDirection }),
  })

  res.status(200).json({
    entries: (entries as NewsEntryRecord[]).map(serializeNewsEntry),
    count,
    offset: skip,
    limit: take,
  })
}

export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const parsed = newsCreateSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid news payload."
    )
  }
  const newsService = req.scope.resolve("news") as NewsService
  const result = await createNewsEntry(req, newsService, parsed.data)
  res.status(result.replayed ? 200 : 201).json(result)
}
